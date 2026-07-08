/**
 * @fileType module
 * @domain kody
 * @pattern kody-chat-send-pipeline
 * @ai-summary The send orchestration extracted from KodyChat (phase
 *   1.6b): `runSendText` owns the full per-turn pipeline for all four
 *   backends (brain / kody-direct / kody-live append / kody-engine
 *   trigger) and `runSendMessage` owns the composer submit path
 *   (/init, plugin send-middleware, waiting-instruction route). Behavior
 *   is identical to the pre-extraction inline code — component state is
 *   injected via the explicit `SendTextDeps` / `SendMessageDeps` objects
 *   built fresh by KodyChat's thin useCallback wrappers, so staleness
 *   semantics (the wrapper's dependency array) are unchanged.
 *
 *   Settle seam (review item 11): every backend's finish/recover
 *   behavior is declared in SETTLE_STRATEGIES / FINISH_STRATEGIES and
 *   applied through ONE pair of functions — `settleDecision` (pure,
 *   unit-tested) + `applySettleDecision` — instead of four interleaved
 *   catch blocks. The strategy table is data: brain aborts pop the
 *   optimistic slice, kody-direct aborts settle the bubble in place,
 *   kody-live surfaces fire-and-ack failures as error bubbles, and the
 *   engine trigger mirrors brain. Errors are uniform error bubbles.
 *
 *   Placement note: this module lives in components/ (not chat/core)
 *   because it necessarily imports the components-zone Message type,
 *   the live-runner hook types, and plugin turn-context helpers — all
 *   forbidden imports for chat/core under the layer zones in
 *   eslint.config.mjs (same placement rationale as
 *   kody-chat-live-runner.ts).
 */
"use client";

import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { AGENT_KODY, AGENTS, type AgentId } from "../agents";
import type { ChatDropdownEntry } from "../chat/platform/agent-entries";
import { trace, type createChatPluginRegistry } from "../chat/platform";
import {
  repoBrainConversationKey,
  repoBrainScopeKey,
} from "../brain/repo-scope";
import { getStoredAuth } from "../api";
import type { KodyTask } from "../types";
import {
  authHeaders,
  stickyBrainChatId,
  isBrainChatPinned,
  liveAuthHeaders,
  brainHeaders,
} from "../chat/core/kody-chat-live-session";
import {
  brainTransport,
  type BrainTurnConfig,
} from "../chat/core/transports/brain";
import {
  kodyDirectTransport,
  type KodyDirectTurnConfig,
} from "../chat/core/transports/kody-direct";
import {
  kodyLiveTransport,
  type KodyLiveTurnConfig,
} from "../chat/core/transports/kody-live";
import {
  createTransportTurnHandler,
  type TransportTurnState,
} from "./kody-chat-transport-events";
import {
  composeUserWireContent,
  formatFileSize,
  shouldCollectPreviewContextForTurn,
} from "./kody-chat-helpers";
import { formatAttachmentForTextBackend } from "../chat/core/attachment-text";
import {
  chatToMessage,
  type Message,
  type ToolCall,
  type Attachment,
  type KodyChatProps,
} from "./kody-chat-types";
import type { AttachmentRef, ChatContext } from "../chat-types";
import type { useChatSessions } from "../chat/core/use-chat-sessions";
import type { useLiveRunner } from "./kody-chat-live-runner";
import { parseReasoning, stripReasoning } from "../chat/core/reasoning";
import {
  extractFirstStaffMentionCandidate,
  type StaffMentionTrigger,
} from "../mentions/agent-mentions";
import {
  pickVibeRequestIssueNumber,
  vibeLiveTaskContext,
  vibeTurnFields,
  type RecentVibeIssue,
} from "../chat/plugins/vibe";
import type { TerminalIntentEffectPayload } from "../chat/plugins/terminal/intent-middleware";
import type { ChatTerminalMode } from "../chat/plugins/terminal/types";
import type { SlashExpansionEffectPayload } from "../chat/plugins/commands";
import type { GoalDirectEffectPayload } from "../chat/plugins/goals";
import {
  isDashboardNavigateDirective,
  isPreviewActDirective,
  isSwitchAgentDirective,
  type DashboardNavigateDirective,
  type PreviewActDirective,
} from "@dashboard/lib/chat-ui-actions";
import { SHOW_VIEW_TOOL } from "@dashboard/lib/chat-output-tools";
import { extractKodyTerminalPayload } from "@dashboard/lib/terminal/kody-terminal-directive";

// ─────────────────────────────────────────────────────────────────────
// Settle seam (review item 11). Per-backend finish/recover behavior is
// DECLARED here as data; the branches below apply it through one pair
// of functions instead of four hand-rolled catch blocks.
// ─────────────────────────────────────────────────────────────────────

export type SettleBackend =
  | "brain"
  | "kody-direct"
  | "kody-live"
  | "kody-engine";

/** Classified turn failure: Stop-button abort vs a real error. */
export type TurnFailure =
  | { kind: "abort"; message: string }
  | { kind: "error"; message: string };

/** How the in-flight assistant bubble resolves. */
export type SettleMessageOp = "pop-last" | "unmark-loading" | "error-bubble";

export interface SettleDecision {
  messageOp: SettleMessageOp;
  /** Whether the typing indicator is cleared as part of the settle. */
  stopLoading: boolean;
  /** Present iff messageOp === "error-bubble". */
  errorMessage?: string;
}

/**
 * The per-backend recover table. Errors are uniform (error bubble);
 * only the ABORT (Stop button) behavior differs per backend:
 *  - brain: pop the optimistic assistant slice (historical behavior —
 *    the typing indicator is left to the reconnect/done machinery).
 *  - kody-direct: settle the in-flight bubble in place (keep streamed
 *    partial text) and clear the typing state.
 *  - kody-live: fire-and-ack append has no abort path — an AbortError
 *    reaching its catch surfaces like any other failure.
 *  - kody-engine: mirrors brain (pop the optimistic slice).
 */
export const SETTLE_STRATEGIES: Record<
  SettleBackend,
  { abort: { messageOp: SettleMessageOp; stopLoading: boolean } }
> = {
  brain: { abort: { messageOp: "pop-last", stopLoading: false } },
  "kody-direct": { abort: { messageOp: "unmark-loading", stopLoading: true } },
  "kody-live": { abort: { messageOp: "error-bubble", stopLoading: true } },
  "kody-engine": { abort: { messageOp: "pop-last", stopLoading: false } },
};

/**
 * The per-backend finish table (documentation-as-data): what happens
 * after a transport send() resolves without throwing.
 *  - brain: clear typing + unmark every loading bubble (applyBrainFinish).
 *  - kody-direct: the empty-turn fallback + display override + deferred
 *    directive application (finalizeKodyDirectTurn).
 *  - kody-live / kody-engine: fire-and-ack — the reply arrives through
 *    the runner event stream, so there is nothing to settle here.
 */
export const FINISH_STRATEGIES: Record<
  SettleBackend,
  "unmark-all" | "direct-finalize" | "none"
> = {
  brain: "unmark-all",
  "kody-direct": "direct-finalize",
  "kody-live": "none",
  "kody-engine": "none",
};

export function classifyTurnFailure(err: unknown): TurnFailure {
  const isAbort =
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError");
  const message = err instanceof Error ? err.message : "Unknown error";
  return isAbort ? { kind: "abort", message } : { kind: "error", message };
}

/** Pure decision: (backend, failure) → how the turn settles. */
export function settleDecision(
  backend: SettleBackend,
  failure: TurnFailure,
): SettleDecision {
  if (failure.kind === "error") {
    return {
      messageOp: "error-bubble",
      stopLoading: true,
      errorMessage: failure.message,
    };
  }
  const abort = SETTLE_STRATEGIES[backend].abort;
  return abort.messageOp === "error-bubble"
    ? { ...abort, errorMessage: failure.message }
    : { ...abort };
}

interface SettleIO {
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setLoading: (loading: boolean) => void;
}

/** Apply a settle decision to the UI — the ONE recover implementation. */
export function applySettleDecision(
  decision: SettleDecision,
  io: SettleIO,
): void {
  if (decision.stopLoading) io.setLoading(false);
  switch (decision.messageOp) {
    case "pop-last":
      io.setMessages((prev) => prev.slice(0, -1));
      return;
    case "unmark-loading":
      io.setMessages((prev) => {
        const copy = [...prev];
        const idx = copy.findIndex(
          (m) => m.role === "assistant" && m.isLoading,
        );
        if (idx >= 0) {
          copy[idx] = { ...copy[idx], isLoading: false };
        }
        return copy;
      });
      return;
    case "error-bubble":
      io.setMessages((prev) => {
        const filtered = prev.filter(
          (m) => !(m.role === "assistant" && m.isLoading),
        );
        return [
          ...filtered,
          {
            role: "assistant",
            content: `Error: ${decision.errorMessage}`,
            isLoading: false,
            isError: true,
          },
        ];
      });
      return;
  }
}

/** Brain finish: clear typing + unmark every loading bubble. */
function applyBrainFinish(io: SettleIO): void {
  io.setLoading(false);
  io.setMessages((prev) =>
    prev.map((m) => (m.isLoading ? { ...m, isLoading: false } : m)),
  );
}

/**
 * Kody-direct finish: mark not loading. If the turn produced NOTHING
 * visible (no answer text, no reasoning, no tool calls) and is not
 * handing off to a runner, surface a note instead of leaving a silent
 * blank bubble — the user must always get feedback. A trailing tool
 * error with no answer surfaces as the error.
 */
function finalizeKodyDirectTurn(params: {
  io: SettleIO;
  turn: TransportTurnState;
  assistantDisplayOverride: string | null | void;
}): void {
  const { io, turn, assistantDisplayOverride } = params;
  const {
    lastToolErrorText,
    lastToolErrorToolName,
    pendingSwitchAgent,
    pendingDashboardNavigate,
    pendingView,
  } = turn;
  io.setMessages((prev) => {
    const copy = [...prev];
    const idx = copy.findIndex((m) => m.role === "assistant" && m.isLoading);
    if (idx >= 0) {
      const m = copy[idx];
      const { reasoning, answer } = parseReasoning(m.content ?? "");
      const hadSuccessfulTools = (m.toolCalls ?? []).some(
        (tc) => tc.status === "success",
      );
      const shouldSurfaceToolError =
        !!lastToolErrorText &&
        !pendingSwitchAgent &&
        !pendingDashboardNavigate &&
        !pendingView &&
        (!answer.trim() || lastToolErrorToolName === SHOW_VIEW_TOOL);
      const producedNothing =
        !answer.trim() &&
        !reasoning.trim() &&
        !hadSuccessfulTools &&
        !pendingSwitchAgent &&
        !pendingDashboardNavigate &&
        !pendingView;
      copy[idx] = shouldSurfaceToolError
        ? {
            ...m,
            isLoading: false,
            isError: true,
            content: `Error: ${lastToolErrorText}`,
          }
        : producedNothing
          ? {
              ...m,
              isLoading: false,
              isError: true,
              content:
                "Kody returned no response. The model may not be configured for this repo, or it ended the turn without a reply — try again, or check Chat Models in Settings.",
            }
          : {
              ...m,
              ...(typeof assistantDisplayOverride === "string"
                ? { content: assistantDisplayOverride }
                : {}),
              isLoading: false,
            };
    }
    return copy;
  });
  io.setLoading(false);
}

// ─────────────────────────────────────────────────────────────────────
// Pipeline dependency surfaces. Built fresh inside KodyChat's thin
// wrappers so staleness semantics match the pre-extraction closures.
// ─────────────────────────────────────────────────────────────────────

type SessionHook = ReturnType<typeof useChatSessions>;
type LiveRunner = ReturnType<typeof useLiveRunner>;
type PluginRegistry = ReturnType<typeof createChatPluginRegistry>;
type MiddlewareContext = Parameters<PluginRegistry["runSendMiddleware"]>[1];
type MessagesUpdater = Message[] | ((prev: Message[]) => Message[]);

export interface SendTextOptions {
  voiceMode?: boolean;
  hidden?: boolean;
  forceAgentId?: AgentId;
  onVoiceDelta?: (spokenSoFar: string) => void;
  onAssistantTextComplete?: (assistantText: string) => string | null | void;
  /**
   * Override the text that goes into the user bubble. Defaults to
   * `messageContent` — set this when the model should see something
   * different from what the user sees (e.g. an expanded slash-command
   * prompt: the model gets the expanded body, the bubble shows only
   * what the user typed).
   */
  displayContent?: string;
}

export interface SendTextDeps {
  // Selection / scope state
  selectedAgentId: AgentId;
  selectedModelId: string | null;
  effectiveReasoningEffort: string | null;
  selectedTask: KodyTask | null;
  capabilitySlug: string | null;
  selectedCapability:
    | Extract<ChatContext, { kind: "capability" }>["capability"]
    | null;
  selectedOrg: Extract<ChatContext, { kind: "org" }> | null;
  selectedReport: Extract<ChatContext, { kind: "report" }>["report"] | null;
  isPlannerMode: boolean;
  plannerGoal: Extract<ChatContext, { kind: "goal-planner" }>["goal"] | null;
  plannerExistingTasks:
    | Extract<ChatContext, { kind: "goal-planner" }>["existingTasks"]
    | undefined;
  onPlannerTasksCreated: (() => void) | undefined;
  onIssueCreated: KodyChatProps["onIssueCreated"];
  onRenderedViewInvalidate?: never;
  vibeMode: KodyChatProps["vibeMode"];
  context: KodyChatProps["context"];
  actorLogin: KodyChatProps["actorLogin"];
  repoAgentSlugs: string[];
  agentList: ChatDropdownEntry[];
  // Session store
  sessionHook: SessionHook;
  messages: Message[];
  setMessagesForSession: (sessionId: string, updater: MessagesUpdater) => void;
  setLoading: (loading: boolean) => void;
  setToolCalls: (toolCalls: ToolCall[]) => void;
  setSelectedAgentId: (id: AgentId) => void;
  setVoiceOverlayOpen: (open: boolean) => void;
  // Refs (read at send time)
  currentPageRef: MutableRefObject<string | null>;
  collectPreviewContextRef: MutableRefObject<() => Promise<string | null>>;
  recentVibeIssueRef: MutableRefObject<RecentVibeIssue | null>;
  brainAbortRef: MutableRefObject<AbortController | null>;
  brainAbortBySessionRef: MutableRefObject<Map<string, AbortController>>;
  kodyAbortRef: MutableRefObject<AbortController | null>;
  kodyAbortBySessionRef: MutableRefObject<Map<string, AbortController>>;
  // Live runner surface
  interactiveStateRef: LiveRunner["interactiveStateRef"];
  interactiveSessionIdRef: LiveRunner["interactiveSessionIdRef"];
  startInteractiveSession: LiveRunner["startInteractiveSession"];
  dispatchLive: LiveRunner["dispatchLive"];
  connectSSE: LiveRunner["connectSSE"];
  // Directive appliers
  runPreviewActionFromDirective: (
    directive: PreviewActDirective,
  ) => Promise<void>;
  runDashboardNavigateFromDirective: (
    directive: DashboardNavigateDirective,
  ) => void;
}

export type SendTextFn = (
  messageContent: string,
  currentAttachments?: Attachment[],
  options?: SendTextOptions,
) => Promise<string | null>;

export async function runSendText(
  deps: SendTextDeps,
  messageContent: string,
  currentAttachments: Attachment[] = [],
  options: SendTextOptions = {},
): Promise<string | null> {
  // Client trace (phase 2 step 2): start/settle markers around the whole
  // turn pipeline. Behavior-neutral — trace never throws, never logs.
  // The empty-message guard below returns before any transport work, so
  // mirror it here to avoid tracing no-op sends.
  const traceAgentId = options.forceAgentId ?? deps.selectedAgentId;
  const shouldTrace =
    Boolean(messageContent.trim()) || currentAttachments.length > 0;
  if (shouldTrace) {
    trace({ kind: "transport:send-start", detail: { agentId: traceAgentId } });
  }
  try {
    return await runSendTextInner(
      deps,
      messageContent,
      currentAttachments,
      options,
    );
  } finally {
    if (shouldTrace) {
      trace({
        kind: "transport:send-settle",
        detail: { agentId: traceAgentId },
      });
    }
  }
}

async function runSendTextInner(
  deps: SendTextDeps,
  messageContent: string,
  currentAttachments: Attachment[] = [],
  options: SendTextOptions = {},
): Promise<string | null> {
  const {
    selectedAgentId,
    selectedModelId,
    effectiveReasoningEffort,
    selectedTask,
    capabilitySlug,
    selectedCapability,
    selectedOrg,
    selectedReport,
    isPlannerMode,
    plannerGoal,
    plannerExistingTasks,
    onPlannerTasksCreated,
    onIssueCreated,
    vibeMode,
    context,
    actorLogin,
    repoAgentSlugs,
    agentList,
    sessionHook,
    messages,
    setMessagesForSession,
    setLoading,
    setToolCalls,
    setSelectedAgentId,
    setVoiceOverlayOpen,
    currentPageRef,
    collectPreviewContextRef,
    recentVibeIssueRef,
    brainAbortRef,
    brainAbortBySessionRef,
    kodyAbortRef,
    kodyAbortBySessionRef,
    interactiveStateRef,
    interactiveSessionIdRef,
    startInteractiveSession,
    dispatchLive,
    connectSSE,
    runPreviewActionFromDirective,
    runDashboardNavigateFromDirective,
  } = deps;

  if (!messageContent.trim() && currentAttachments.length === 0) return null;

  // Voice streaming: emit the spoken-so-far text (think tags stripped)
  // on each delta so the voice loop can speak completed sentences while
  // the rest of the reply is still generating. No-op outside voice mode.
  const emitVoiceDelta =
    options.voiceMode && options.onVoiceDelta
      ? (full: string) => options.onVoiceDelta!(stripReasoning(full))
      : null;

  // Voice mode is a MODALITY. It does NOT swap agents — the user's
  // dropdown choice still drives the brain and tools. The server
  // appends a TTS-friendly overlay to that agent's system prompt
  // when we set `voiceMode: true` on the request. For agents whose
  // backend isn't the in-process chat path (brain, kody-engine,
  // kody-live), we still route through /api/kody/chat/kody for
  // voice — the kody route falls back to AGENT_KODY for those and
  // applies the overlay there.
  const voiceMode = options.voiceMode === true;
  const effectiveAgentId: AgentId = options.forceAgentId ?? selectedAgentId;
  const effectiveAgent = AGENTS[effectiveAgentId] ?? AGENT_KODY;

  const timestamp = new Date().toISOString();

  // Attachment refs (id + metadata) for the persisted message. The blob
  // itself lives in IDB; the data URL stays in `currentAttachments` for
  // this turn's outgoing request only.
  const attachmentRefs: AttachmentRef[] = currentAttachments.map((a) => ({
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
  }));

  // The user's bubble shows just the typed text — the attachment chips
  // are rendered separately from `attachments`. No base64 in the text.
  // Callers can override via `options.displayContent` when the model
  // should see something different (e.g. an expanded slash-command
  // prompt — the user bubble still shows the typed input).
  const displayContent = options.displayContent ?? messageContent;

  // Preview page context is invisible in the UI. Kody-direct receives it
  // as a separate context field so renderer/tool routing sees only the
  // user's real words; text-only backends still need it appended. Image
  // turns are different: the screenshot is the evidence, and hidden DOM
  // text can pull vision models toward a stale/wrong page description.
  const imageTurnHasVisualEvidence = currentAttachments.some((a) =>
    a.mimeType.startsWith("image/"),
  );
  const previewContext = shouldCollectPreviewContextForTurn({
    hidden: options.hidden === true,
    hasImageAttachments: imageTurnHasVisualEvidence,
  })
    ? await collectPreviewContextRef.current()
    : null;
  const wireContent = composeUserWireContent({
    messageContent,
    previewContext,
    backend: effectiveAgent.backend,
  });
  const uiSessionId =
    sessionHook.activeSession?.id ?? sessionHook.createSession();
  const turnMessages =
    sessionHook.activeSession?.id === uiSessionId
      ? messages
      : sessionHook.getSessionMessages(uiSessionId).map(chatToMessage);
  const setMessages = (
    updater: Message[] | ((prev: Message[]) => Message[]),
  ) => {
    setMessagesForSession(uiSessionId, updater);
  };

  // Build the prior-conversation transcript for the Kody backend. It
  // gets the cleaned-up text only; older attachments are referenced by
  // ref count only (not re-uploaded) — Kody's stateless route only
  // needs the current turn's images.
  // Build the transcript we send back to the model. Three rules:
  //
  // 1. Strip <think>…</think> blocks from any assistant content. The
  //    chat client wraps model thought summaries in those tags so
  //    the collapsed reasoning panel can render them, but the model
  //    should never see its own private thoughts replayed as prior
  //    "assistant" turns — it triggers a narration loop where the
  //    next reply continues thinking-style ("I must acknowledge…").
  // 2. Drop synthetic error bubbles. isError: true catches the
  //    tagged ones; the "Error: " content prefix catches legacy
  //    persisted bubbles saved before the flag existed.
  // 3. Drop empty assistant bubbles (no real text after stripping).
  //    They come from aborted turns or turns where the model only
  //    produced reasoning. Sending them back makes the model "continue
  //    from nothing" and often regress into apologies.
  const priorMessages = turnMessages
    .map((m) => {
      if (m.role !== "assistant") return m;
      if (m.isError) return null;
      if (m.content.startsWith("Error: ")) return null;
      const cleaned = stripReasoning(m.content);
      if (!cleaned) return null;
      return { ...m, content: cleaned };
    })
    .filter((m): m is Message => m !== null)
    .map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp ?? timestamp,
    }));

  setMessages((prev) => [
    ...prev,
    {
      role: "user",
      content: displayContent,
      timestamp,
      attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
      // Hidden synthetic turns (preview-act follow-ups) ride the wire so
      // the model observes new state, but the renderer skips them — the
      // user only sees their own prompts + assistant replies.
      ...(options.hidden ? { hidden: true } : {}),
    },
  ]);

  const directAgentSlug =
    !options.hidden && !voiceMode && !options.forceAgentId
      ? extractFirstStaffMentionCandidate(displayContent, repoAgentSlugs)
      : null;

  // Resolve the session id only for backends that actually need one
  // (engine + brain). The kody-direct route is stateless and doesn't
  // use it. We defer createSession() to those branches because calling
  // it eagerly here creates a *second* session — the first setMessages
  // above already auto-created one, but `sessionHook.activeSession` is
  // a stale closure and reads as null, tripping createSession() into
  // splitting user/assistant across two sessions.
  const resolveSessionId = (): string => {
    if (selectedTask) return selectedTask.id;
    if (capabilitySlug != null) return `capability-${capabilitySlug}`;
    return uiSessionId;
  };

  setLoading(true);
  setToolCalls([]);

  // Placeholder assistant message — will be replaced by SSE events
  setMessages((prev) => [
    ...prev,
    {
      role: "assistant",
      content: "",
      isLoading: true,
      timestamp: new Date().toISOString(),
    },
  ]);

  // ─── Brain backend: sync SSE stream from a Brain server ───
  // Two flavors share this branch, distinguished by selectedAgentId:
  //   - 'brain'     → user-managed external server, URL/key from Settings
  //                   (sent as x-brain-url/x-brain-key headers).
  //                   Routes to /api/kody/chat/brain.
  //   - 'brain-fly' -> Repo Brain on a user-owned Fly runtime. Credentials
  //                    are resolved server-side from FLY_API_TOKEN in the
  //                    repo vault. Routes to /api/kody/chat/brain-fly,
  //                    no client-side credentials.
  // Voice mode rides through Brain when the selected agent's
  // `supportsVoice` flag is true (the brain server applies the voice
  // overlay server-side, per the shared contract in
  // src/dashboard/lib/voice/overlay.ts).
  const isBrainAgent =
    !directAgentSlug &&
    (effectiveAgentId === "brain" || effectiveAgentId === "brain-fly");
  if (isBrainAgent) {
    const brainEndpoint =
      effectiveAgentId === "brain-fly"
        ? "/api/kody/chat/brain-fly"
        : "/api/kody/chat/brain";
    const brainExtraHeaders: Record<string, string> =
      effectiveAgentId === "brain-fly" ? {} : brainHeaders();
    brainAbortBySessionRef.current.get(uiSessionId)?.abort();
    const abort = new AbortController();
    brainAbortBySessionRef.current.set(uiSessionId, abort);
    brainAbortRef.current = abort;

    // Scope chat memory per user + per task so every issue gets its own
    // Brain session. `sessionId` alone (a bare issue number) would collide
    // across users working on the same task.
    const userKey = actorLogin ?? "anon";
    const brainSessionId = resolveSessionId();
    // Logical key is the stable conversation identity *without* userKey —
    // it must not change when actorLogin transiently flips to "anon".
    //
    // Scope it by the selected repo too: Brain clones a worktree on the
    // first turn of a chatId and keeps it for the life of that chat. If the
    // key ignored the repo, switching repos in the dashboard would reuse
    // the same Brain chat — still bound to the *old* repo's worktree — and
    // bare issue numbers (`task-5`) would collide across repos. Prefixing
    // with owner/repo makes a repo switch start a fresh Brain chat that
    // clones the correct repo, keeping dashboard selection and Brain in sync.
    const repoScope = repoBrainScopeKey(getStoredAuth());
    const brainLogicalKey = selectedTask
      ? repoBrainConversationKey(repoScope, {
          type: "task",
          id: selectedTask.id,
        })
      : selectedCapability
        ? repoBrainConversationKey(repoScope, {
            type: "capability",
            slug: selectedCapability.slug,
          })
        : repoBrainConversationKey(repoScope, {
            type: "global",
            sessionId: brainSessionId,
          });
    // First turn = no chatId pinned yet for this conversation. Must be
    // read *before* stickyBrainChatId (which pins). Used to send the
    // dashboard Context block once — Brain is stateful and keeps it.
    const brainFirstTurn = !isBrainChatPinned(brainLogicalKey);
    const brainChatId = stickyBrainChatId(
      brainLogicalKey,
      `${userKey}--${brainLogicalKey}`,
    );

    // When chatting about a specific task, pass a compact context blob so
    // Brain answers in the context of that issue. Brain's route injects it
    // server-side before forwarding to the Brain chat server.
    const taskContext = selectedTask
      ? {
          issueNumber: selectedTask.issueNumber,
          title: selectedTask.title,
          body: selectedTask.body,
          state: selectedTask.state,
          labels: selectedTask.labels,
          column: selectedTask.column,
          pipeline: selectedTask.pipeline
            ? {
                state: selectedTask.pipeline.state,
                currentStage: selectedTask.pipeline.currentStage,
              }
            : undefined,
          associatedPR: selectedTask.associatedPR
            ? {
                number: selectedTask.associatedPR.number,
                state: selectedTask.associatedPR.state,
                html_url: selectedTask.associatedPR.html_url,
              }
            : undefined,
        }
      : undefined;

    // For Brain we send the clean user text plus attachments as a separate
    // structured field so the Brain server can build a proper multimodal
    // prompt (text + image blocks) rather than treating data URLs as text.
    const brainAttachments = currentAttachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      data: a.data,
    }));

    // Everything protocol-shaped — the reconnect loop (the Vercel
    // proxy is hard-killed at ~300s, so a long turn arrives across
    // several connections), the cold-start retry gate, and the SSE
    // parsing — lives in the brain transport adapter
    // (chat/core/transports/brain.ts). This branch assembles the
    // request body from component state, maps the adapter's
    // ChatEvents back onto the UI via the shared turn handler, and
    // keeps its historical abort/error semantics.
    const brainTurnConfig = {
      endpoint: brainEndpoint,
      chatId: brainChatId,
      initialBody: {
        chatId: brainChatId,
        message: wireContent,
        // Brain has no ambient-context slot either; the route
        // prefixes this onto the forwarded user message.
        ...(currentPageRef.current
          ? { currentPage: currentPageRef.current }
          : {}),
        // Send the dashboard Context block once, on the first
        // turn — the route loads it server-side (vault access)
        // and prefixes it onto the message. Brain keeps it for
        // the chat's life, so later turns skip the token cost.
        ...(brainFirstTurn ? { includeContext: true } : {}),
        ...(taskContext ? { taskContext } : {}),
        ...(selectedCapability
          ? {
              capabilityContext: {
                slug: selectedCapability.slug,
                title: selectedCapability.title,
                body: selectedCapability.body,
              },
            }
          : {}),
        ...(brainAttachments.length > 0
          ? { attachments: brainAttachments }
          : {}),
        // Voice modality. Brain forwards this to the upstream
        // chat server, which is responsible for appending the
        // voice overlay to its system prompt for this turn.
        ...(voiceMode ? { voiceMode: true } : {}),
        // Thinking level. Brain chat rows don't surface a
        // `reasoning` dropdown in the picker (Brain owns its
        // own reasoning config), but we forward the field when
        // it's set so a future Brain server version can pick
        // it up without a route change.
        ...(effectiveReasoningEffort
          ? { reasoningEffort: effectiveReasoningEffort }
          : {}),
      },
    } satisfies BrainTurnConfig;
    const brainTurn = createTransportTurnHandler({
      setMessages,
      setLoading,
      emitVoiceDelta,
      voiceMode,
    });
    try {
      await brainTransport.send(
        {
          sessionId: uiSessionId,
          text: wireContent,
          agentId: effectiveAgentId,
          ...(effectiveReasoningEffort
            ? { reasoningEffort: effectiveReasoningEffort }
            : {}),
          context: brainTurnConfig,
        },
        {
          authHeaders: { ...authHeaders(), ...brainExtraHeaders },
          signal: abort.signal,
          emit: brainTurn.handleEvent,
        },
      );

      // Reconnect budget ran out — the handler already surfaced the
      // error bubble; nothing to hand to TTS.
      if (brainTurn.state.exhausted) {
        return null;
      }

      // FINISH_STRATEGIES.brain — clear typing, unmark loading bubbles.
      applyBrainFinish({ setMessages, setLoading });
      // Voice mode: defense-in-depth strip of `<think>` blocks before
      // handing the reply to TTS. The brain server is expected to drop
      // them when voiceMode is set, but the dashboard should never
      // narrate them even if an old server leaks them through.
      const spokenText = voiceMode
        ? stripReasoning(brainTurn.state.latestAssistantText)
        : brainTurn.state.latestAssistantText;
      return spokenText || null;
    } catch (error) {
      // Settle seam: abort pops the optimistic slice, real errors
      // surface an error bubble (SETTLE_STRATEGIES.brain).
      applySettleDecision(settleDecision("brain", classifyTurnFailure(error)), {
        setMessages,
        setLoading,
      });
      return null;
    } finally {
      if (brainAbortBySessionRef.current.get(uiSessionId) === abort) {
        brainAbortBySessionRef.current.delete(uiSessionId);
      }
      if (brainAbortRef.current === abort) {
        brainAbortRef.current = null;
      }
    }
  }

  // ─── Kody direct backend: in-process LLM stream, no Actions/Brain ───
  // Any agent with backend === 'kody-direct' routes here. Voice on
  // a kody-direct agent rides this branch with `voiceMode: true` on
  // the body so the route appends the voice overlay to the agent's
  // system prompt. Voice on a brain agent rides the Brain branch
  // above and is overlay'd server-side by the brain server.
  if (effectiveAgent.backend === "kody-direct" || directAgentSlug) {
    // Forward task context when the user is chatting about a specific
    // task — same shape Brain receives, so the server can anchor the
    // reply in the right issue/PR.
    const kodyTaskContext = selectedTask
      ? {
          issueNumber: selectedTask.issueNumber,
          title: selectedTask.title,
          body: selectedTask.body,
          state: selectedTask.state,
          labels: selectedTask.labels,
          column: selectedTask.column,
          pipeline: selectedTask.pipeline
            ? {
                state: selectedTask.pipeline.state,
                currentStage: selectedTask.pipeline.currentStage,
              }
            : undefined,
          associatedPR: selectedTask.associatedPR
            ? {
                number: selectedTask.associatedPR.number,
                state: selectedTask.associatedPR.state,
                html_url: selectedTask.associatedPR.html_url,
              }
            : undefined,
        }
      : // Bridge: if we JUST created a vibe issue but the task scope hasn't
        // propagated yet, still scope this turn to that issue so the server
        // can bind the hand-off (and strip create tools) correctly.
        (() => {
          const bridged = pickVibeRequestIssueNumber({
            selectedTaskIssueNumber: null,
            vibeMode: vibeMode === true,
            recent: recentVibeIssueRef.current,
            nowMs: Date.now(),
          });
          return bridged != null ? { issueNumber: bridged } : undefined;
        })();

    // Build the user-turn content. If we have attachments, send them as
    // structured parts (text + image) so the model sees real images,
    // not base64 strings stuffed into the text. Without attachments,
    // send a plain string to keep the request shape identical to before.
    const userTurnContent: unknown =
      currentAttachments.length > 0
        ? [
            ...(wireContent.trim()
              ? [{ type: "text" as const, text: wireContent }]
              : []),
            ...currentAttachments.map((a) =>
              a.mimeType.startsWith("image/")
                ? {
                    type: "image" as const,
                    image: a.data,
                    mimeType: a.mimeType,
                  }
                : {
                    type: "file" as const,
                    data: a.data,
                    mediaType: a.mimeType,
                    filename: a.name,
                  },
            ),
          ]
        : wireContent;

    const kodyMessages = [
      ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userTurnContent },
    ];

    // Fresh AbortController per turn — Stop button calls .abort() on
    // whichever request is in-flight. Cancel any prior controller in
    // the unlikely case a previous turn never settled.
    kodyAbortBySessionRef.current.get(uiSessionId)?.abort();
    const kodyAbort = new AbortController();
    kodyAbortBySessionRef.current.set(uiSessionId, kodyAbort);
    kodyAbortRef.current = kodyAbort;
    // Protocol mechanics — the SSE parse, tool bookkeeping, and
    // directive shape detection — live in the kody-direct transport
    // adapter (chat/core/transports/kody-direct.ts). This branch
    // assembles the request body from component state, maps the
    // adapter's ChatEvents onto the UI via the shared turn handler,
    // then applies the deferred directives after the stream settles.
    const kodyTurn = createTransportTurnHandler({
      setMessages,
      setLoading,
      emitVoiceDelta,
      voiceMode,
    });
    try {
      const kodyTurnConfig = {
        endpoint: "/api/kody/chat/kody",
        body: {
          messages: kodyMessages,
          task: kodyTaskContext,
          agentId: directAgentSlug ? "kody" : effectiveAgentId,
          ...(directAgentSlug ? { agentSlug: directAgentSlug } : {}),
          // Voice modality flag. When true the server appends the
          // voice overlay (no markdown, short sentences, etc.) to
          // the selected agent's system prompt and prefers the
          // speech-flagged model if no model is explicitly set.
          ...(voiceMode ? { voiceMode: true } : {}),
          // Vibe flips the system prompt to "you ARE the executor" and
          // strips the @kody dispatch tools. Only meaningful when the
          // chat is hosted on /vibe; the dashboard rail leaves it off.
          // (Wire shape owned by chat/plugins/vibe/turn-context.ts.)
          ...vibeTurnFields(vibeMode),
          // Forward the user-managed gateway model id when one is
          // active. The server validates against the LLM_MODELS list,
          // so a stale value falls back to the configured default.
          ...(selectedModelId ? { model: selectedModelId } : {}),
          // Forward the user's picked thinking level. Server translates
          // to the provider's wire shape (anthropic_budget, openai_effort,
          // gemini_budget, etc.) at request time. Omitted when the
          // active model has no reasoning config.
          ...(effectiveReasoningEffort
            ? { reasoningEffort: effectiveReasoningEffort }
            : {}),
          ...(actorLogin ? { actorLogin } : {}),
          // The dashboard page the user is on, so "what am I viewing?"
          // resolves. Surfaced as a `## Current page` system section.
          ...(currentPageRef.current
            ? { currentPage: currentPageRef.current }
            : {}),
          ...(previewContext ? { previewContext } : {}),
          ...(selectedOrg
            ? {
                org: {
                  owner: selectedOrg.org,
                  repositories: selectedOrg.repositories ?? [],
                },
              }
            : {}),
          ...(selectedCapability
            ? {
                capability: {
                  slug: selectedCapability.slug,
                  title: selectedCapability.title,
                  body: selectedCapability.body,
                },
              }
            : {}),
          ...(selectedReport
            ? {
                report: {
                  slug: selectedReport.slug,
                  title: selectedReport.title,
                  body: selectedReport.body,
                },
              }
            : {}),
          ...(isPlannerMode && plannerGoal
            ? {
                goalPlanner: true,
                goal: {
                  id: plannerGoal.id,
                  name: plannerGoal.name,
                  description: plannerGoal.description,
                  dueDate: plannerGoal.dueDate,
                  ...(plannerExistingTasks
                    ? { existingTasks: plannerExistingTasks }
                    : {}),
                },
              }
            : {}),
        },
      } satisfies KodyDirectTurnConfig;
      await kodyDirectTransport.send(
        {
          sessionId: uiSessionId,
          text: wireContent,
          agentId: directAgentSlug ? "kody" : effectiveAgentId,
          ...(selectedModelId ? { modelId: selectedModelId } : {}),
          ...(effectiveReasoningEffort
            ? { reasoningEffort: effectiveReasoningEffort }
            : {}),
          context: kodyTurnConfig,
        },
        {
          authHeaders: authHeaders(),
          signal: kodyAbort.signal,
          emit: kodyTurn.handleEvent,
        },
      );

      // Per-turn results accumulated by the event handler. Pending UI
      // directives are applied AFTER the stream settles (below) so the
      // agent flip / navigation / preview chain doesn't race the
      // in-flight assistant render.
      const {
        textBuf,
        pendingSwitchAgent,
        pendingDashboardNavigate,
        pendingPreviewAct,
        pendingCreatedIssue,
      } = kodyTurn.state;

      const assistantText = textBuf.trim();
      let assistantDisplayOverride: string | null | void = undefined;
      if (options.onAssistantTextComplete) {
        try {
          assistantDisplayOverride =
            options.onAssistantTextComplete(assistantText);
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Failed to handle Kody terminal response",
          );
        }
      }

      // FINISH_STRATEGIES["kody-direct"] — empty-turn fallback, tool
      // error surfacing, and the display override live in the settle
      // module's finalizer so the behavior is declared in one place.
      finalizeKodyDirectTurn({
        io: { setMessages, setLoading },
        turn: kodyTurn.state,
        assistantDisplayOverride,
      });
      // Apply any UI-control directives the model emitted. Done after
      // the assistant bubble settles so the agent flip doesn't race
      // the in-flight render or interrupt voice TTS that is still
      // speaking the confirmation sentence.
      if (pendingSwitchAgent && isSwitchAgentDirective(pendingSwitchAgent)) {
        const target = pendingSwitchAgent;
        setSelectedAgentId(target.agentId);
        // Mirror the model-emitted switch onto the active session so
        // a refresh / session re-open keeps the same agent. The
        // directive carries only `agentId` (no modelId) so we match
        // the dropdown row by agentId and forward its entry key —
        // for `kody` rows we keep the previously-selected modelId
        // (the directive didn't ask to change it).
        const targetEntry = agentList.find(
          (e) =>
            e.agentId === target.agentId &&
            (e.agentId !== "kody" || e.modelId === selectedModelId),
        );
        const activeId = sessionHook.activeSession?.id;
        if (activeId && targetEntry) {
          sessionHook.setSessionAgent(activeId, targetEntry.key);
        }
        // If voice is active and the new agent isn't backed by the
        // in-process chat path, close the overlay. The overlay is
        // appended server-side on /api/kody/chat/kody only — engine
        // and brain agents proxy to backends that don't honor the
        // voice overlay, so leaving the mic open after a switch to
        // them would speak markdown-heavy replies.
        const targetBackend = AGENTS[target.agentId]?.backend;
        if (voiceMode && targetBackend !== "kody-direct") {
          setVoiceOverlayOpen(false);
        }
        // Defer the kickoff dispatch to a useEffect so we can wait
        // for the new agent + matching task scope to settle before
        // sending. See the comment on `pendingKickoff` near the top
        // of the component for why both must align first — and why
        // the issue-number gate is load-bearing.
        if (target.autoKickoff && target.autoKickoff.trim().length > 0) {
          dispatchLive({
            type: "KICKOFF_QUEUED",
            content: target.autoKickoff,
            issueNumber: target.autoKickoffIssueNumber ?? null,
          });
        }
      }
      // Preview action: hand the spec to the inspector extension, run
      // it in the preview frame, then push the result back into the
      // conversation as a synthetic user turn. The model sees that on
      // its next turn and decides whether to keep going (multi-step
      // flows) or finish.
      if (pendingPreviewAct && isPreviewActDirective(pendingPreviewAct)) {
        const directive = pendingPreviewAct as PreviewActDirective;
        void runPreviewActionFromDirective(directive);
      }
      if (
        pendingDashboardNavigate &&
        isDashboardNavigateDirective(pendingDashboardNavigate)
      ) {
        runDashboardNavigateFromDirective(pendingDashboardNavigate);
      }
      // Planner mode: a Pass 2 turn typically creates one or more issues
      // via `create_task_for_goal`. We can't observe per-tool results
      // from this stream protocol cheaply, so fire the host callback on
      // every successful planner completion. The host (GoalControl)
      // invalidates `useKodyTasks`; the cache layer dedups the cost.
      if (isPlannerMode && onPlannerTasksCreated) {
        try {
          onPlannerTasksCreated();
        } catch {
          // Host callback errors should never break the chat.
        }
      }
      // Issue-creation navigation: the unified chat thread does NOT
      // migrate per-issue. The conversation that created the issue
      // stays in the global session; the host just navigates to the
      // new issue and the next turn's system-prompt block carries
      // `## Current task = #N` so the model acknowledges the new
      // scope without losing history.
      if (pendingCreatedIssue !== null && onIssueCreated) {
        const newIssueNumber = pendingCreatedIssue;
        // Remember the just-created issue so the NEXT turn(s) scope to it
        // even if the page's task-scope flip hasn't propagated yet (the
        // "turn 2 carries no issue → wrong hand-off" bug).
        recentVibeIssueRef.current = {
          issueNumber: newIssueNumber,
          at: Date.now(),
        };
        try {
          onIssueCreated(newIssueNumber);
        } catch {
          // Host callback errors should never break the chat.
        }
      }
      // Voice mode needs the spoken text only — no reasoning, no
      // empty string. `textBuf` is the answer the model would render
      // in a normal text bubble. We additionally strip any
      // `<think>…</think>` blocks the model wrote INTO the text
      // stream (some providers route thoughts through text-delta
      // instead of reasoning-delta, especially under OpenAI-compat
      // shims) so TTS never narrates them.
      const spoken = voiceMode ? stripReasoning(textBuf) : textBuf.trim();
      return spoken || null;
    } catch (err) {
      // Stop button fired — fetch/reader throws an AbortError. That's
      // not a real failure; the settle table maps it to settling the
      // bubble in place (SETTLE_STRATEGIES["kody-direct"]). Real
      // failures surface an error bubble.
      applySettleDecision(
        settleDecision("kody-direct", classifyTurnFailure(err)),
        { setMessages, setLoading },
      );
      return null;
    } finally {
      // Drop the controller so the next turn starts fresh.
      if (kodyAbortRef.current === kodyAbort) {
        kodyAbortRef.current = null;
      }
      if (kodyAbortBySessionRef.current.get(uiSessionId) === kodyAbort) {
        kodyAbortBySessionRef.current.delete(uiSessionId);
      }
    }
  }

  // ─── Kody Live: long-lived interactive runner ───
  // First send always auto-starts the runner if there's no live session
  // (or the previous one ended). The user message gets queued through
  // /append — the runner reads the session JSONL on its first git pull,
  // so we don't need to wait for chat.ready before queueing.
  if (
    effectiveAgentId === "kody-live" ||
    effectiveAgentId === "kody-live-fly"
  ) {
    const liveUserContent =
      currentAttachments.length > 0
        ? currentAttachments
            .map((a) => {
              const sizeStr = formatFileSize(a.size);
              if (a.mimeType.startsWith("image/"))
                return `[Image: ${a.name} (${sizeStr})]\n${a.data}`;
              return `[File: ${a.name} (${a.mimeType}, ${sizeStr})]\n${a.data}`;
            })
            .join("\n\n") + (wireContent ? `\n\n${wireContent}` : "")
        : wireContent;

    const liveTaskContext = vibeLiveTaskContext(
      vibeMode,
      context?.kind === "task" ? context.task : null,
    );

    // First turn into a fresh session: hand the message to /start so it's
    // written ATOMICALLY with the meta line. Previously we started the
    // runner then appended in a second request — the two writes raced and
    // the turn was frequently lost, so the runner booted to an empty
    // session and idle-exited (handoff "ran" but nothing happened, chat
    // stuck on a spinner). When start carries the turn, skip the append.
    let firstTurnPersistedByStart = false;
    if (
      (interactiveStateRef.current === "idle" ||
        interactiveStateRef.current === "ended") &&
      !interactiveSessionIdRef.current
    ) {
      await startInteractiveSession({
        initialContent: liveUserContent,
        initialTimestamp: timestamp,
        taskContext: liveTaskContext,
        uiSessionId,
      });
      firstTurnPersistedByStart = true;
    }
    const liveSessionId = interactiveSessionIdRef.current;
    const liveState = interactiveStateRef.current;
    if (!liveSessionId || (liveState !== "ready" && liveState !== "booting")) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Live runner failed to start. Try again, or check Fly Config.",
          isLoading: false,
          isError: true,
        },
      ]);
      return null;
    }

    // Mark the session as awaiting a reply. The reducer will flip back
    // to 'ready' on chat.message or chat.done — so even if chat.done
    // never arrives (engine drops it on commit-only turns), the typing
    // indicator clears as soon as the assistant message lands.
    dispatchLive({ type: "TURN_SENT" });
    // The first turn already rode into the session file via /start — no
    // append needed (and appending again would duplicate it).
    if (firstTurnPersistedByStart) {
      return null;
    }
    // The append POST (dispatch mechanics) lives in the kody-live
    // transport adapter (chat/core/transports/kody-live.ts). The
    // runner lifecycle — start, rehydration, SSE, phase reducer —
    // stays here, reducer-driven. Fire-and-ack: the reply arrives via
    // the runner event stream, so there are no events to map.
    try {
      await kodyLiveTransport.send(
        {
          sessionId: liveSessionId,
          text: liveUserContent,
          agentId: effectiveAgentId,
          context: {
            kind: "append",
            body: {
              taskId: liveSessionId,
              content: liveUserContent,
              timestamp,
              // Same as the trigger path: the live runner reads the turn from
              // the session JSONL, so page context travels in the turn.
              ...(currentPageRef.current
                ? { currentPage: currentPageRef.current }
                : {}),
              ...vibeTurnFields(vibeMode, liveTaskContext),
            },
          } satisfies KodyLiveTurnConfig,
        },
        {
          authHeaders: liveAuthHeaders(liveSessionId),
          emit: () => {},
        },
      );
      return null;
    } catch (error) {
      // Settle seam: fire-and-ack has no abort path — every failure
      // surfaces as an error bubble (SETTLE_STRATEGIES["kody-live"]).
      applySettleDecision(
        settleDecision("kody-live", classifyTurnFailure(error)),
        { setMessages, setLoading },
      );
      return null;
    }
  }

  // ─── Kody engine backend: async via GH Actions workflow ───
  const sessionId = resolveSessionId();
  // The engine's trigger workflow expects plain string content. Keep small
  // attachments inline, but omit oversized raw data so screenshots do not
  // blow the model context window before the runner starts.
  const engineUserContent =
    currentAttachments.length > 0
      ? currentAttachments
          .map((a) => {
            return formatAttachmentForTextBackend({
              kind: a.mimeType.startsWith("image/") ? "image" : "file",
              name: a.name,
              mimeType: a.mimeType,
              sizeLabel: formatFileSize(a.size),
              data: a.data,
            });
          })
          .join("\n\n") + (wireContent ? `\n\n${wireContent}` : "")
      : wireContent;

  const engineMessages = [
    ...priorMessages,
    { role: "user" as const, content: engineUserContent, timestamp },
  ];

  // The GH Actions dispatch (trigger POST) lives in the kody-live
  // transport adapter — same fire-and-ack model as append: the reply
  // streams back through the engine's event feed, not this call.
  try {
    await kodyLiveTransport.send(
      {
        sessionId,
        text: engineUserContent,
        agentId: effectiveAgentId,
        context: {
          kind: "trigger",
          body: {
            taskId: sessionId,
            messages: engineMessages,
            dashboardUrl:
              typeof window !== "undefined"
                ? window.location.origin
                : undefined,
            // Engine has no system slot for ambient context; the route
            // prefixes this onto the latest user turn the engine reads.
            ...(currentPageRef.current
              ? { currentPage: currentPageRef.current }
              : {}),
            ...vibeTurnFields(
              vibeMode,
              vibeLiveTaskContext(
                vibeMode,
                context?.kind === "task" ? context.task : null,
              ),
            ),
          },
        } satisfies KodyLiveTurnConfig,
      },
      { authHeaders: authHeaders(), emit: () => {} },
    );

    // For task chats a separate useEffect opens the SSE on
    // selectedTask.id; global chats (no task) would otherwise never
    // see the engine's reply because nothing watches the session id.
    // Open the stream here so both modes are covered.
    connectSSE(sessionId, { uiSessionId });
    return null;
  } catch (error) {
    // Settle seam: mirrors brain — abort pops the optimistic slice,
    // real errors surface a bubble (SETTLE_STRATEGIES["kody-engine"]).
    applySettleDecision(
      settleDecision("kody-engine", classifyTurnFailure(error)),
      { setMessages, setLoading },
    );
    return null;
  }
}

export interface SendMessageDeps {
  chatMode: ChatTerminalMode;
  input: string;
  attachments: Attachment[];
  contextChips: Array<{ id: string; label: string; context: string }>;
  isKodyWaiting: boolean;
  selectedTask: KodyTask | null;
  plannerGoal: Extract<ChatContext, { kind: "goal-planner" }>["goal"] | null;
  onDirectToGoal: KodyChatProps["onDirectToGoal"];
  // Composer state writers
  setInput: (value: string) => void;
  setContextChips: (chips: SendMessageDeps["contextChips"]) => void;
  setAttachments: (attachments: Attachment[]) => void;
  setSlashMenuOpen: (open: boolean) => void;
  setSlashSelectedIndex: (index: number) => void;
  setAgentMentionTrigger: (trigger: StaffMentionTrigger | null) => void;
  setMessages: (updater: MessagesUpdater) => void;
  // Plugin platform
  pluginRegistry: PluginRegistry;
  pluginHost: MiddlewareContext["host"];
  handlePluginHostEffect: MiddlewareContext["dispatchHostEffect"];
  pendingTerminalIntentRef: MutableRefObject<TerminalIntentEffectPayload | null>;
  pendingSlashExpansionRef: MutableRefObject<SlashExpansionEffectPayload | null>;
  pendingGoalDirectRef: MutableRefObject<GoalDirectEffectPayload | null>;
  consumePendingTerminalIntent: () => TerminalIntentEffectPayload | null;
  consumePendingSlashExpansion: () => SlashExpansionEffectPayload | null;
  consumePendingGoalDirect: () => GoalDirectEffectPayload | null;
  // Terminal + preview
  sendInputToTerminal: () => void;
  sendKodyTerminalPayloadToTerminal: (payload: string) => boolean;
  previewActChainRef: MutableRefObject<number>;
  // The turn pipeline
  sendText: SendTextFn;
}

export async function runSendMessage(deps: SendMessageDeps): Promise<void> {
  const {
    chatMode,
    input,
    attachments,
    contextChips,
    isKodyWaiting,
    selectedTask,
    plannerGoal,
    onDirectToGoal,
    setInput,
    setContextChips,
    setAttachments,
    setSlashMenuOpen,
    setSlashSelectedIndex,
    setAgentMentionTrigger,
    setMessages,
    pluginRegistry,
    pluginHost,
    handlePluginHostEffect,
    pendingTerminalIntentRef,
    pendingSlashExpansionRef,
    pendingGoalDirectRef,
    consumePendingTerminalIntent,
    consumePendingSlashExpansion,
    consumePendingGoalDirect,
    sendInputToTerminal,
    sendKodyTerminalPayloadToTerminal,
    previewActChainRef,
    sendText,
  } = deps;

  if (chatMode === "terminal") {
    sendInputToTerminal();
    return;
  }

  if (!input.trim() && attachments.length === 0 && contextChips.length === 0)
    return;
  // A real user prompt restarts the budget for chained preview actions.
  previewActChainRef.current = 0;
  const typedInput = input.trim();

  // Built-in `/init` — deterministic engine install. Bypasses the LLM
  // entirely: hits the install endpoint, renders the result as a chat
  // message. Anchored to the start so "//init" or text containing
  // "/init" still passes through to normal handling.
  if (/^\/init(\s|$)/.test(typedInput)) {
    setInput("");
    setSlashMenuOpen(false);
    setSlashSelectedIndex(0);
    const force = /\s--force(\s|$)/.test(typedInput);
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { role: "user" as const, content: typedInput, timestamp: now },
      {
        role: "assistant" as const,
        content: "⚙️ Installing the Kody engine in this repo…",
        timestamp: now,
      },
    ]);
    try {
      const res = await fetch("/api/kody/engine/install", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));
      const content =
        res.ok && data.ok
          ? [
              `✅ ${data.summary}`,
              data.workflow?.htmlUrl
                ? `\nWorkflow: ${data.workflow.htmlUrl}`
                : "",
              Array.isArray(data.nextSteps) && data.nextSteps.length
                ? `\n**Next steps**\n${data.nextSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          : `❌ Install failed: ${data.error ?? data.message ?? res.statusText}`;
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant" as const,
          content,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant" as const,
          content: `❌ Install failed: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    return;
  }

  // Plugin send-middleware chain (Step 4). The goals plugin's
  // goal-mention middleware (order 50, Step 5d) CONSUMES a message that
  // mentions a known goal (`#<n>` / `goal:<n>`); the terminal plugin's
  // terminal-intent middleware (order 100, Step 5a) rewrites
  // `/terminal <x>` to the Kody terminal prompt; the commands plugin's
  // slash-expansion middleware (order 200, Step 5b) expands
  // `/review` / `/explain foo` into the command body with $ARGUMENTS
  // substituted. The model never sees the slash form (every backend
  // just gets normal text); unknown slugs pass through unchanged so
  // users can still type "/"-prefixed text freely. Terminal intents
  // skip expansion by construction — the order-100 rewrite no longer
  // starts with "/". Each middleware hands the raw typed text back
  // through a synchronous host effect for the user bubble. A middleware
  // that consumes the message stops the send.
  pendingTerminalIntentRef.current = null;
  pendingSlashExpansionRef.current = null;
  pendingGoalDirectRef.current = null;
  const middlewareOutcome = pluginRegistry.runSendMiddleware(typedInput, {
    host: pluginHost,
    dispatchHostEffect: handlePluginHostEffect,
  });
  if (middlewareOutcome.consumedBy) {
    // "Direct chat to a goal by id": re-scope this chat to the mentioned
    // goal's planner and keep the rest of the message in the composer
    // for the user to send into the now-goal-scoped thread. Consuming
    // the mention on its own Enter keeps it race-free (the scope swap
    // drives a re-render before anything is sent). A mention of the
    // goal we're already in just strips the token (the `!==` guard
    // skips a redundant re-scope).
    const goalDirect = consumePendingGoalDirect();
    if (goalDirect) {
      if (goalDirect.goalId !== plannerGoal?.id) {
        onDirectToGoal?.(goalDirect.goalId);
      }
      setInput(goalDirect.rest);
      setSlashMenuOpen(false);
      setSlashSelectedIndex(0);
      return;
    }
    setInput("");
    setSlashMenuOpen(false);
    setAgentMentionTrigger(null);
    setSlashSelectedIndex(0);
    return;
  }
  const terminalIntent = consumePendingTerminalIntent();
  const slashExpansion = consumePendingSlashExpansion();

  // The user bubble shows the raw typed text while the model receives
  // the chain's output (Kody terminal prompt / expanded command body).
  const rawInput = terminalIntent
    ? terminalIntent.rawText
    : slashExpansion
      ? slashExpansion.rawText
      : middlewareOutcome.text;
  const baseMessage = middlewareOutcome.text;
  // Append any attached context chips (picked preview elements) to the
  // outgoing message, so the model sees the element details even though the
  // composer only showed compact pills.
  const currentChips = [...contextChips];
  const userMessage = [baseMessage, ...currentChips.map((c) => c.context)]
    .filter((s) => s.trim())
    .join("\n\n");
  const visibleUserMessage =
    rawInput || currentChips.map((chip) => chip.label).join("\n");
  setInput("");
  setContextChips([]);
  setSlashMenuOpen(false);
  setAgentMentionTrigger(null);
  setSlashSelectedIndex(0);
  const currentAttachments = [...attachments];
  setAttachments([]);

  // If Kody is waiting for instructions, route to the action instruction endpoint
  if (!terminalIntent && isKodyWaiting && selectedTask?.id) {
    try {
      await fetch("/api/kody/action/instruction", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          runId: selectedTask.id,
          instruction: userMessage,
        }),
      });
      // Add a temporary "instruction sent" message to the chat
      setMessages((prev) => [
        ...prev,
        {
          role: "user" as const,
          content: visibleUserMessage,
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant" as const,
          content: `📬 Instruction sent to Kody — waiting for response...`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.error("Failed to send instruction:", err);
    }
    return;
  }

  const sendOptions = terminalIntent
    ? {
        displayContent: rawInput,
        forceAgentId: "kody" as const,
        onAssistantTextComplete: (assistantText: string) => {
          const payload = extractKodyTerminalPayload(assistantText);
          if (!payload) {
            toast.error("Kody did not return a terminal block");
            return null;
          }
          sendKodyTerminalPayloadToTerminal(payload);
          return "Sent to terminal";
        },
      }
    : slashExpansion || currentChips.length > 0
      ? { displayContent: visibleUserMessage }
      : undefined;

  // When a slash command or context chip matched, the user bubble must show
  // only the user-facing text. The model still receives `userMessage`,
  // which may include expanded prompt bodies and hidden context payloads.
  await sendText(userMessage, currentAttachments, sendOptions);
}
