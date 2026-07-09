"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { navLabelForPath } from "./settings-nav";
import { useLiveRunner } from "./kody-chat-live-runner";
import { FileText, FileCode } from "lucide-react";
import {
  createChatPluginRegistry,
  FULL_GRANT,
  trace,
  type ChatHostEffect,
} from "../chat/platform";
import { ChatSurfaceLayout } from "../chat/surface/ChatSurfaceLayout";
import { useAuth } from "../auth-context";
import { toast } from "sonner";
import type { KodyTask } from "../types";
// Terminal HOST wiring (phase 1.6d): registry, checkpoints, payload
// hand-off, chrome state + the lazy terminal chrome nodes all live in
// the useTerminalHost hook (kody-chat-terminal-host.tsx). Only the
// effect reader (send-middleware hand-off) stays imported here.
import {
  readTerminalIntentEffect,
  type TerminalIntentEffectPayload,
} from "../chat/plugins/terminal/intent-middleware";
import { useTerminalHost } from "./kody-chat-terminal-host";
import { useComposerHandlers } from "./kody-chat-composer-handlers";
import {
  SlashCommandMenu,
  parseSlashTrigger,
  readSlashExpansionEffect,
  useSlashCommands,
  type SlashExpansionEffectPayload,
} from "../chat/plugins/commands";
import {
  readGoalDirectEffect,
  type GoalDirectEffectPayload,
} from "../chat/plugins/goals";
import { useElementPicker } from "../picker/useElementPicker";
import { formatPageInfo } from "../picker/protocol";
import { runPreviewAction } from "../picker/run-preview-action";
import { formatMacrosCatalog, type Macro } from "../macros";
import {
  authHeaders,
  clearLiveSession,
} from "../chat/core/kody-chat-live-session";
import { runSendText, runSendMessage, type SendTextFn } from "./kody-chat-send";
import {
  chatToMessage,
  messageToChat,
  type Message,
  type ToolCall,
  type Attachment,
  type KodyChatProps,
} from "./kody-chat-types";
import type { ChatMessage } from "../chat-types";
import {
  putAttachment,
  deleteAttachment,
  purgeOrphans,
} from "../attachment-store";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  ChatIssueReportDialog,
  type ChatIssueReportState,
} from "./ChatIssueReportDialog";
import { useRemoteStatus } from "../hooks/useRemoteStatus";
import { useAgents } from "../hooks/useAgents";
import { useChatDataSources } from "./kody-chat-data";
import { useAgentSelection } from "./kody-chat-selection";
import { useVoiceOrchestration } from "./kody-chat-voice";
import { PIPER_VOICES } from "@dashboard/lib/voice/voices";
import { VoiceChatOverlay } from "./VoiceChatOverlay";
import { useChatSessions } from "../chat/core/use-chat-sessions";
import { useKodyActionState } from "../hooks/useKodyActionState";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { SessionsPanel } from "../chat/surface/SessionsPanel";
import { HeaderControls } from "../chat/surface/HeaderControls";
import { MessageList } from "../chat/surface/MessageList";
import { Composer } from "../chat/surface/Composer";
import type { StaffMentionTrigger } from "../mentions/agent-mentions";
import { EmptyState } from "../chat/surface/EmptyState";
import type { RecentVibeIssue } from "../chat/plugins/vibe";
import type {
  DashboardNavigateDirective,
  RenderedViewAction,
  RenderedViewDirective,
  PreviewActDirective,
} from "@dashboard/lib/chat-ui-actions";
import { repoScopedHref } from "@dashboard/lib/routes";

function reportValue(value: unknown, max = 1_000): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.join(", ")
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function reportItem(
  label: string,
  value: unknown,
  max?: number,
): { label: string; value: string } | null {
  const normalized = reportValue(value, max);
  return normalized ? { label, value: normalized } : null;
}

function compactReportItems(
  items: Array<{ label: string; value: string } | null>,
): Array<{ label: string; value: string }> {
  return items.filter(Boolean) as Array<{ label: string; value: string }>;
}

export function KodyChat({
  context,
  actorLogin,
  onClose,
  onCollapseRail,
  onToggleFullscreen,
  railFullscreen,
  lockedAgentId,
  lockedModelId,
  lockedAgentSlug,
  hideAgentPicker,
  compactHeader,
  allowSessionSidebarPin = true,
  autoOpenSessionSidebar = true,
  kodyDirectHeaders,
  messageRoleLayout,
  vibeMode,
  onIssueCreated,
  knownGoals,
  onDirectToGoal,
  composerInjection,
  attachmentInjection,
  previewContext,
  presentation = "rail",
  hideTerminalMode,
  plugins,
  capabilityGrant,
}: KodyChatProps) {
  const router = useRouter();
  // Current route — drives the page-aware composer placeholder AND tells the
  // model which dashboard page the user is looking at ("what am I viewing?").
  const pathname = usePathname();
  const pageLabel = navLabelForPath(pathname);
  // Noun phrase passed to the backends. The client owns nav labels; each
  // route owns how it frames this (system section vs. user-turn prefix).
  const currentPage = pathname
    ? pageLabel
      ? `the ${pageLabel} page (${pathname})`
      : `the page at ${pathname}`
    : null;
  // Read at send-time from inside send callbacks (which may close over a stale
  // render), so a ref always reflects the page the user is on right now.
  const currentPageRef = useRef<string | null>(currentPage);
  currentPageRef.current = currentPage;
  // Context-kind derivations.
  const selectedOrg = context?.kind === "org" ? context : null;
  const selectedTask: KodyTask | null =
    context?.kind === "task" ? context.task : null;
  const selectedCapability =
    context?.kind === "capability" ? context.capability : null;
  // Goal-planner mode: chat scoped to a Goal, used for the "Plan this goal"
  // workflow (Pass 1 list-in-chat → user approves → Pass 2 create issues).
  const plannerGoal = context?.kind === "goal-planner" ? context.goal : null;
  const plannerSessionId =
    context?.kind === "goal-planner" ? context.sessionId : null;
  const plannerExistingTasks =
    context?.kind === "goal-planner" ? context.existingTasks : undefined;
  const onPlannerTasksCreated =
    context?.kind === "goal-planner" ? context.onTasksCreated : undefined;
  const onPlannerExit =
    context?.kind === "goal-planner" ? context.onExit : undefined;
  // Report mode: chat scoped to a markdown report on /reports. The agent
  // is framed to advise: create issue, attach to a goal, or no action.
  const selectedReport = context?.kind === "report" ? context.report : null;

  // Per-scope (task / capability / planner / global) scope blocks flow through
  // the existing per-turn system-prompt blocks (## Current task / ## Current
  // capability / ## Goal planning mode / ## Current report). The thread itself is
  // one global store keyed by sessionId — no per-scope parallel stores.

  const [input, setInput] = useState("");
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [agentMentionTrigger, setAgentMentionTrigger] =
    useState<StaffMentionTrigger | null>(null);
  const [agentMentionSelectedIndex, setAgentMentionSelectedIndex] = useState(0);
  // Context chips attached to the composer (e.g. picked preview elements).
  // Shown as removable pills above the input; their `context` is appended to
  // the outgoing message on send so the visible input stays clean.
  const [contextChips, setContextChips] = useState<
    Array<{ id: string; label: string; context: string }>
  >([]);
  // Add a picker selection as a chip. Keyed by id so a re-render with the same
  // selection doesn't double-add; a new id adds exactly one chip.
  const lastInjectionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !composerInjection ||
      composerInjection.id === lastInjectionIdRef.current
    ) {
      return;
    }
    lastInjectionIdRef.current = composerInjection.id;
    setContextChips((prev) => [...prev, composerInjection]);
  }, [composerInjection]);
  const removeContextChip = useCallback((id: string) => {
    setContextChips((prev) => prev.filter((c) => c.id !== id));
  }, []);
  // Add an injected image (e.g. a preview screenshot) as a chat attachment,
  // mirroring a user file drop. Keyed by id so re-renders don't duplicate it.
  const lastAttachmentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !attachmentInjection ||
      attachmentInjection.id === lastAttachmentIdRef.current
    ) {
      return;
    }
    lastAttachmentIdRef.current = attachmentInjection.id;
    const { id, name, dataUrl, mimeType } = attachmentInjection;
    void (async () => {
      let storedId = id;
      let size = 0;
      try {
        const blob = await (await fetch(dataUrl)).blob();
        size = blob.size;
        const ref = await putAttachment({ name, mimeType, size, blob });
        storedId = ref.id;
      } catch (err) {
        // IDB/convert failed — fall back to a transient, non-rehydratable id.
        console.error("Screenshot attachment failed to persist:", err);
      }
      setAttachments((prev) => [
        ...prev,
        { id: storedId, name, type: mimeType, size, data: dataUrl, mimeType },
      ]);
    })();
  }, [attachmentInjection]);
  // Slash command autocomplete state. Open while the user is typing the
  // slug portion of `/foo` (no space yet). Once a space is typed the
  // menu closes and we treat the rest of the line as arguments. Enter
  // expands `/slug args` against the prompt list before sending.
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  const [, setLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [usedViewIds, setUsedViewIds] = useState<Set<string>>(() => new Set());
  // ─── Chat plugin platform (Step 4 mechanics, Step 6 injection) ───
  // One registry PER MOUNT (plan H4: ChatRailShell mounts KodyChat twice;
  // plugin manifests are global pure data, instantiation is per mount).
  // `plugins`/`capabilityGrant` are mount-time config — read once in the
  // useState initializer, never re-registered on re-render.
  // KodyChat owns ONLY the registration mechanics; the HOST surface passes
  // its plugin list (Step 6 / M6 — per-surface imports, so /client sheds
  // admin plugin code): ChatRailShell registers terminal + commands + vibe
  // + goals on both of its mounts, GoalControl's planner dialog registers
  // terminal + commands + vibe (it never routes goals), ClientChatSurface
  // registers branding + commands under its minimal grant. Registration
  // order = array order (theme/slot merge order); middleware ordering is
  // registry-sorted by `order` regardless.
  // With no plugins at all the registry is inert: slots render nothing and
  // the send-middleware chain passes through.
  const [pluginRegistry] = useState(() => {
    const registry = createChatPluginRegistry();
    const grant = capabilityGrant ?? FULL_GRANT;
    for (const entry of plugins ?? []) {
      registry.register(entry.plugin, grant);
      trace({ kind: "plugin:register", detail: entry.plugin.id });
    }
    return registry;
  });
  // Terminal-intent hand-off: the terminal plugin's send middleware
  // dispatches this effect SYNCHRONOUSLY during runSendMiddleware, so
  // sendMessage reads the ref right after the chain returns.
  const pendingTerminalIntentRef = useRef<TerminalIntentEffectPayload | null>(
    null,
  );
  const consumePendingTerminalIntent =
    useCallback((): TerminalIntentEffectPayload | null => {
      const intent = pendingTerminalIntentRef.current;
      pendingTerminalIntentRef.current = null;
      return intent;
    }, []);
  // Slash-expansion hand-off (Step 5b): same synchronous ref pattern —
  // the commands plugin's middleware dispatches the expansion effect
  // during runSendMiddleware; sendMessage reads the raw typed text for
  // the user bubble right after the chain returns.
  const pendingSlashExpansionRef = useRef<SlashExpansionEffectPayload | null>(
    null,
  );
  const consumePendingSlashExpansion =
    useCallback((): SlashExpansionEffectPayload | null => {
      const expansion = pendingSlashExpansionRef.current;
      pendingSlashExpansionRef.current = null;
      return expansion;
    }, []);
  // Goal-direct hand-off (Step 5d): same synchronous ref pattern — the
  // goals plugin's mention middleware CONSUMES the message and dispatches
  // this effect during runSendMiddleware; sendMessage's consumed branch
  // reads it and runs the existing onDirectToGoal path (scope swap + rest
  // of the message back into the composer).
  const pendingGoalDirectRef = useRef<GoalDirectEffectPayload | null>(null);
  const consumePendingGoalDirect =
    useCallback((): GoalDirectEffectPayload | null => {
      const goalDirect = pendingGoalDirectRef.current;
      pendingGoalDirectRef.current = null;
      return goalDirect;
    }, []);
  // Host-effect switch. Plugins dispatch effects (scope changes, navigation
  // requests) here — unknown kinds are ignored by design.
  const handlePluginHostEffect = useCallback((effect: ChatHostEffect) => {
    trace({ kind: "host-effect", detail: effect.kind });
    const terminalIntent = readTerminalIntentEffect(effect);
    if (terminalIntent) {
      pendingTerminalIntentRef.current = terminalIntent;
      return;
    }
    const slashExpansion = readSlashExpansionEffect(effect);
    if (slashExpansion) {
      pendingSlashExpansionRef.current = slashExpansion;
      return;
    }
    const goalDirect = readGoalDirectEffect(effect);
    if (goalDirect) {
      pendingGoalDirectRef.current = goalDirect;
      return;
    }
    switch (effect.kind) {
      default:
        break;
    }
  }, []);
  useEffect(() => {
    const unsubscribe = pluginRegistry.onHostEffect(handlePluginHostEffect);
    return () => {
      unsubscribe();
    };
  }, [pluginRegistry, handlePluginHostEffect]);
  // Reactive: re-derives whenever the auth context updates `brain`. Without
  // useAuth this stayed stale because KodyChat lives in the persistent rail
  // and never remounts after Settings saves a Brain config — the dropdown
  // entry wouldn't appear until a full page reload.
  const { auth } = useAuth();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // Slash command list (builtins + state repo `commands/*.md`).
  // Stale-while-revalidate keeps autocomplete instant; the API itself
  // is cached on the server side via the GitHub client.
  const { commands: slashCommands } = useSlashCommands(auth);
  // Brain visibility is driven exclusively by the per-user Settings entry
  // (URL + API key in localStorage). A server-wide `BRAIN_CHAT_URL` env on
  // the deployment used to also surface the row, but that meant every
  // user of the deployment saw "Kody Brain" whether they'd configured it
  // or not — confusing, and pickable into a 401 loop. Settings is now the
  // single source of truth for whether the row appears.
  const brainConfigured = Boolean(auth?.brain?.url && auth?.brain?.apiKey);
  // Mount-time data loads (phase 1.6c: kody-chat-data.ts) — the chat model
  // list, the Repo Brain chat toggle, and the FLY_API_TOKEN vault probe.
  const { chatModels, chatModelsLoaded, brainFlyChatEnabled, flyConfigured } =
    useChatDataSources();

  // Use one session bucket for Vibe. The selected task is request context, not
  // a separate visible conversation; otherwise issue creation navigates to an
  // empty task chat and hides the message that created the issue.
  const desiredSessionScope: import("../chat/core/use-chat-sessions").ChatSessionScope =
    vibeMode ? "vibe-default" : "global";
  // Commit scope changes only after they settle. A transient context flip
  // (parent re-render / task refetch momentarily dropping the selection)
  // would otherwise swap useChatSessions to the empty `vibe-default` bucket
  // and wipe the visible history until a manual refresh. A short settle
  // window absorbs flickers (they revert within the same tick) while real
  // user-driven task select/clear persists well past it.
  const [sessionStoreScope, setSessionStoreScope] =
    useState<import("../chat/core/use-chat-sessions").ChatSessionScope>(
      desiredSessionScope,
    );
  const sessionHook = useChatSessions(sessionStoreScope);
  const createChatSession = sessionHook.createSession;

  // Agent/model selection (phase 1.6c: kody-chat-selection.ts) — selected
  // agent/model state, dropdown entries, default resolution, family snap,
  // reasoning-effort wiring, and the per-session agent sync effect.
  const {
    selectedAgentId,
    setSelectedAgentId,
    selectedModelId,
    setSelectedModelId,
    agentMenuOpen,
    setAgentMenuOpen,
    reasoningMenuOpen,
    setReasoningMenuOpen,
    setReasoningEffort,
    currentAgent,
    agentList,
    currentEntry,
    currentReasoning,
    effectiveReasoningEffort,
    onRehydrateRestored,
  } = useAgentSelection({
    lockedAgentId: lockedAgentId ?? (lockedModelId ? "kody" : undefined),
    lockedModelId,
    brainConfigured,
    flyConfigured,
    brainFlyChatEnabled,
    chatModels,
    chatModelsLoaded,
    sessionHook,
  });

  // Read-only host snapshot handed to slot components and send middleware.
  // Minimal by design (plan H2 host-context channel) — grows per plugin
  // need, not speculatively. `slashCommands` feeds the commands plugin's
  // slash-expansion middleware (Step 5b); `knownGoals` feeds the goals
  // plugin's mention middleware (Step 5d): the manifests are static pure
  // data, so the async-loaded lists travel via host context.
  const pluginHost = useMemo(
    () => ({ pathname, agentId: selectedAgentId, slashCommands, knownGoals }),
    [pathname, selectedAgentId, slashCommands, knownGoals],
  );
  const brainAbortRef = useRef<AbortController | null>(null);
  const brainAbortBySessionRef = useRef(new Map<string, AbortController>());
  // AbortController for the in-process chat path (`/api/kody/chat/kody`).
  // Without this the Stop button can't cancel the in-flight stream — the
  // model keeps generating, tokens keep flowing into the assistant bubble,
  // and the user has no recourse. Mirrors the Brain backend's pattern.
  const kodyAbortRef = useRef<AbortController | null>(null);
  const kodyAbortBySessionRef = useRef(new Map<string, AbortController>());
  // Preview-DOM auto-attach. The Kody Preview Inspector extension reports
  // the preview frame's URL/title/selection/DOM outline. The user-facing
  // toggle lives on the PreviewInspector toolbar (preview surfaces only);
  // this just reads the persisted flag at send time and silently injects
  // the snapshot when on. On non-preview tabs the extension's
  // collect-page resolves null and nothing is attached.
  const previewPicker = useElementPicker({ onSelect: () => {} });
  const previewPickerRef = useRef(previewPicker);
  previewPickerRef.current = previewPicker;
  const previewContextRef = useRef<string | null>(null);
  previewContextRef.current = previewContext?.trim() || null;
  const AUTO_CONTEXT_KEY = "kody:preview-auto-context";
  const collectPreviewContextRef = useRef<() => Promise<string | null>>(
    async () => null,
  );
  collectPreviewContextRef.current = async () => {
    // Read the persisted flag fresh each send — the toggle lives on the
    // preview toolbar in another component tree, so we can't subscribe to
    // its state directly. Default ON when unset.
    let enabled = true;
    try {
      const v = window.localStorage.getItem(AUTO_CONTEXT_KEY);
      enabled = v === null ? true : v === "1";
    } catch {
      /* keep default */
    }
    if (!enabled) return null;
    const parts: string[] = [];
    if (previewContextRef.current) parts.push(previewContextRef.current);
    if (!previewPickerRef.current.available) {
      return parts.length > 0 ? parts.join("\n\n") : null;
    }
    try {
      const info = await previewPickerRef.current.collectPage(300);
      if (!info) return parts.length > 0 ? parts.join("\n\n") : null;
      // Append the saved-macros catalog so the model can offer to run them
      // when the user mentions one by name ("run my Login macro"). Macros
      // now live in the state repo (macros.json), so fetch per-send — newly
      // saved macros are visible immediately, and it works across devices.
      parts.push(formatPageInfo(info));
      try {
        const res = await fetch("/api/kody/macros", { headers: authHeaders() });
        if (res.ok) {
          const data = (await res.json()) as { macros?: Macro[] };
          const macrosBlock = formatMacrosCatalog(data.macros ?? []);
          if (macrosBlock) parts.push(macrosBlock);
        }
      } catch {
        /* best-effort: macros catalog is optional context */
      }
      return parts.join("\n\n");
    } catch {
      return parts.length > 0 ? parts.join("\n\n") : null;
    }
  };
  // Depth counter for chained `preview_act` calls. The dashboard auto-feeds
  // each post-action DOM snapshot back to the model as a hidden user turn so
  // it can chain steps; this ref caps the chain so a runaway model can't
  // loop forever. Reset on every real user send (sendMessage).
  const previewActChainRef = useRef(0);
  const MAX_PREVIEW_ACT_CHAIN = 8;
  // Deferred handle to the send pipeline (type owned by kody-chat-send.ts).
  const sendTextRef = useRef<SendTextFn | null>(null);
  // Voice orchestration (phase 1.6c: kody-chat-voice.ts) — overlay/mute
  // state, the Piper voice preference, and the voice→sendText→TTS glue.
  // Reads the send pipeline through `sendTextRef` (bound each render right
  // after `sendText` is declared below), so it can mount before it.
  const {
    voiceChat,
    voiceMuted,
    setVoiceMuted,
    voiceOverlayOpen,
    setVoiceOverlayOpen,
    voiceId,
    handleSelectVoice,
    handleVoiceToggleMute,
  } = useVoiceOrchestration({ sendTextRef });
  // Initialized lazily below — `sendText` is declared further down.
  const runPreviewActionFromDirective = useCallback(
    async (directive: PreviewActDirective) => {
      await runPreviewAction(directive, {
        pickerAvailable: () => previewPickerRef.current.available,
        act: (action) => previewPickerRef.current.act(action),
        sendText: async (content, _atts, opts) => {
          const send = sendTextRef.current;
          if (!send) return null;
          return send(content, [], opts);
        },
        toastSuccess: (m) => toast.success(m),
        toastError: (m) => toast.error(m),
        getChainDepth: () => previewActChainRef.current,
        incrementChainDepth: () => {
          previewActChainRef.current += 1;
        },
        maxAutoActions: MAX_PREVIEW_ACT_CHAIN,
      });
    },
    [],
  );
  const runDashboardNavigateFromDirective = useCallback(
    (directive: DashboardNavigateDirective) => {
      const href = auth ? repoScopedHref(auth, directive.href) : directive.href;
      router.push(href);
      toast.success(`Opened ${directive.label}`);
    },
    [auth, router],
  );
  const { data: repoAgents = [] } = useAgents();
  const repoAgentSlugs = useMemo(
    () => repoAgents.map((agent) => agent.slug),
    [repoAgents],
  );
  const filteredAgentMentions = useMemo(() => {
    if (!agentMentionTrigger) return [];
    return repoAgents
      .filter((agent) =>
        agent.slug.toLowerCase().includes(agentMentionTrigger.query),
      )
      .slice(0, 6);
  }, [agentMentionTrigger, repoAgents]);
  // Generic switch-agent auto-kickoff queue lives in the live-session reducer.
  // Vibe execution does not use this path; it is owned by the Vibe page's
  // `/api/kody/vibe/execute` workflow.

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showIssueReport, setShowIssueReport] = useState(false);
  const [issueReportState, setIssueReportState] =
    useState<ChatIssueReportState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The vibe issue this chat JUST created (set in the issue-creation transfer
  // below). Used to scope the immediately-following turns to that issue while
  // the page's task scope (context.kind === "task") catches up — without it,
  // the turn right after creation carries no issue and the server can't bind
  // the runner hand-off to the right one. See chat/plugins/vibe/recent-issue.ts.
  const recentVibeIssueRef = useRef<RecentVibeIssue | null>(null);

  // Remote dev status (only polls when actorLogin is provided)
  const { data: remoteStatus } = useRemoteStatus(actorLogin);

  // Session sidebar state (for session management feature)
  const [showSessionSidebar, setShowSessionSidebar] = useState(false);
  const previousRailFullscreenRef = useRef(railFullscreen);
  const [sessionSidebarPinned, setSessionSidebarPinned] = useState(() => {
    if (!allowSessionSidebarPin) return false;
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem("kody-chat:sessions-panel-pinned") === "1"
    );
  });
  useEffect(() => {
    const wasRailFullscreen = previousRailFullscreenRef.current;
    previousRailFullscreenRef.current = railFullscreen;

    if (wasRailFullscreen && !railFullscreen) {
      setShowSessionSidebar(false);
    }
  }, [railFullscreen]);
  useEffect(() => {
    if (!allowSessionSidebarPin) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "kody-chat:sessions-panel-pinned",
      sessionSidebarPinned ? "1" : "0",
    );
    if (sessionSidebarPinned && isDesktop) setShowSessionSidebar(true);
  }, [allowSessionSidebarPin, isDesktop, sessionSidebarPinned]);

  // Reset the visible stream state on agent switch. Session switches are
  // intentionally allowed while a reply is running; each send now writes
  // back to the session id it started from.
  const activeSessionIdForReset = sessionHook.activeSession?.id ?? null;
  // Terminal HOST wiring (phase 1.6d) — registry, checkpoint load/save,
  // payload hand-off, chrome state and the lazy terminal chrome nodes all
  // live in useTerminalHost (kody-chat-terminal-host.tsx).
  const {
    chatMode,
    modeBySessionId: terminalModeBySessionId,
    sendInputToTerminal,
    sendKodyTerminalPayloadToTerminal,
    terminalSendBusy,
    terminalSendDisabled,
    terminalInputLabel,
    terminalProblemMessage,
    chatModeToggle,
    terminalBottomControls,
    terminalSurfaces,
  } = useTerminalHost({
    actorLogin,
    vibeMode,
    hideTerminalMode,
    lockedAgentId,
    pluginRegistry,
    activeSessionIdForReset,
    createChatSession,
    sessions: sessionHook.sessions,
    sessionsHydrated: sessionHook.hydrated,
    sessionStoreScope,
    input,
    setInput,
    setSlashMenuOpen,
    setSlashSelectedIndex,
    composerTextareaRef,
    setContextChips,
  });
  // Client trace: record display-mode flips (ai ↔ terminal). Inspection
  // only — no behavior change (trace never throws, never logs).
  useEffect(() => {
    trace({ kind: "display-mode", detail: chatMode });
  }, [chatMode]);
  useEffect(() => {
    if (desiredSessionScope === sessionStoreScope) return;
    const t = setTimeout(() => setSessionStoreScope(desiredSessionScope), 150);
    return () => clearTimeout(t);
  }, [desiredSessionScope, sessionStoreScope]);

  // Poll action state — detects when Kody is waiting for instructions
  const { state: actionState, isWaiting: isKodyWaiting } = useKodyActionState(
    selectedTask?.id,
  );

  // Mode discriminator. Used to drive per-turn system-prompt scope blocks
  // (## Current task / ## Current capability / ## Goal planning mode / ## Current
  // report) and the context bar in the chat header. The thread itself is
  // the unified global store — these flags do NOT change which messages
  // render or which store receives writes.
  const isTaskMode = !!selectedTask;
  const isCapabilityMode = !!selectedCapability;
  const isPlannerMode = !!plannerGoal && !!plannerSessionId;
  const isGlobalMode = !isTaskMode && !isCapabilityMode && !isPlannerMode;

  useEffect(() => {
    if (autoOpenSessionSidebar && railFullscreen && isGlobalMode) {
      setShowSessionSidebar(true);
    }
  }, [autoOpenSessionSidebar, railFullscreen, isGlobalMode]);

  // All chat messages live in the global session store. The sessionHook
  // owns a single `messages` list per active session; the page/scope
  // (task, capability, planner, report) flows through the per-turn system
  // prompt, not a separate message store.
  const capabilitySlug: string | null = selectedCapability?.slug ?? null;
  const messages: Message[] = sessionHook.messages.map(chatToMessage);

  const setMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      sessionHook.setMessages((prevChat: ChatMessage[]) => {
        const newMessages =
          typeof updater === "function"
            ? updater(prevChat.map(chatToMessage))
            : updater;
        return newMessages.map(messageToChat);
      });
    },
    [sessionHook],
  );
  const setMessagesForSession = useCallback(
    (
      sessionId: string,
      updater: Message[] | ((prev: Message[]) => Message[]),
    ) => {
      sessionHook.setSessionMessages(sessionId, (prevChat: ChatMessage[]) => {
        const newMessages =
          typeof updater === "function"
            ? updater(prevChat.map(chatToMessage))
            : updater;
        return newMessages.map(messageToChat);
      });
    },
    [sessionHook],
  );
  const activeLoading = messages.some((m) => m.isLoading);

  // Kody Live runner lifecycle — reducer orchestration, event poll, SSE,
  // localStorage persistence + scope rehydration, and the zombie watchdog
  // all live in the useLiveRunner hook (extracted phase 1.6a; see
  // kody-chat-live-runner.ts). This component keeps the send paths, the
  // auto-kickoff firing effect below, and all UI wiring.
  const {
    liveState,
    dispatchLive,
    interactiveSessionIdRef,
    interactiveStateRef,
    currentScopeKeyRef,
    bootElapsed,
    eventSourceRef,
    connectSSE,
    startInteractiveSession,
    endInteractiveSession,
    restartInteractiveSession,
    rehydrateForScope,
  } = useLiveRunner({
    selectedAgentId,
    context,
    vibeMode,
    selectedTaskId: selectedTask?.id ?? null,
    capabilitySlug,
    activeSessionIdForReset,
    effectiveReasoningEffort,
    setLoading,
    setMessages,
    setMessagesForSession,
    onRehydrateRestored,
  });

  // Render aliases — kept named to minimise churn at JSX read sites.
  const interactiveState = liveState.phase;
  const interactiveTarget = liveState.target;
  const pendingKickoff = liveState.pendingKickoff;

  // Reset the visible stream state on agent switch. Session switches are
  // intentionally allowed while a reply is running; each send now writes
  // back to the session id it started from.
  const prevAgentIdRef = useRef<string>(selectedAgentId);
  useEffect(() => {
    const agentChanged = selectedAgentId !== prevAgentIdRef.current;
    prevAgentIdRef.current = selectedAgentId;

    if (agentChanged) {
      const sessionId = activeSessionIdForReset;
      if (sessionId) {
        brainAbortBySessionRef.current.get(sessionId)?.abort();
        kodyAbortBySessionRef.current.get(sessionId)?.abort();
      } else {
        brainAbortRef.current?.abort();
        kodyAbortRef.current?.abort();
      }
      eventSourceRef.current?.close();
      setLoading(false);
      setToolCalls([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionIdForReset, selectedAgentId]);

  const captureIssueReportState = useCallback((): ChatIssueReportState => {
    const visibleMessages = messages.filter((message) => !message.hidden);
    const recentMessages = visibleMessages.slice(-6).map((message) => ({
      role: message.role,
      text:
        reportValue(
          message.content ||
            (message.toolCalls?.length
              ? `[${message.toolCalls.length} tool call(s)]`
              : ""),
          1_200,
        ) ?? "[empty message]",
    }));
    const recentToolCalls = [
      ...visibleMessages.flatMap((message) => message.toolCalls ?? []),
      ...toolCalls,
    ]
      .slice(-8)
      .map((tool) => ({
        name: tool.name,
        status: tool.status,
        summary: reportValue(tool.result ?? tool.arguments, 800) ?? undefined,
      }));

    const pageItems = compactReportItems([
      reportItem("Page", currentPageRef.current),
      reportItem("Path", pathname),
      reportItem(
        "Repo",
        auth?.owner && auth?.repo ? `${auth.owner}/${auth.repo}` : null,
      ),
      reportItem("User", actorLogin),
    ]);

    const chatItems = compactReportItems([
      reportItem("Mode", chatMode),
      reportItem("Agent", currentAgent.name),
      reportItem("Selected model", selectedModelId),
      reportItem("Active loading", activeLoading ? "yes" : "no"),
      reportItem("Live runner", interactiveState),
      reportItem("Live target", interactiveTarget),
      reportItem("Live error", liveState.errorMessage, 500),
      reportItem("Session", sessionHook.activeSession?.id),
    ]);

    const contextItems = compactReportItems([
      reportItem(
        "Task",
        selectedTask
          ? `#${selectedTask.issueNumber} ${selectedTask.title}`
          : null,
        500,
      ),
      reportItem("Task column", selectedTask?.column),
      reportItem("Task pipeline", selectedTask?.pipeline?.state),
      reportItem("Capability", selectedCapability?.slug),
      reportItem("Report", selectedReport?.slug),
      reportItem(
        "Goal",
        plannerGoal ? `${plannerGoal.id}: ${plannerGoal.name}` : null,
      ),
      reportItem("Org", selectedOrg?.org),
    ]);

    return {
      sections: [
        ...(pageItems.length ? [{ title: "Page", items: pageItems }] : []),
        ...(chatItems.length ? [{ title: "Chat", items: chatItems }] : []),
        ...(contextItems.length
          ? [{ title: "Selected context", items: contextItems }]
          : []),
      ],
      recentMessages,
      recentToolCalls,
    };
  }, [
    activeLoading,
    actorLogin,
    auth?.owner,
    auth?.repo,
    chatMode,
    currentAgent.name,
    interactiveState,
    interactiveTarget,
    liveState.errorMessage,
    messages,
    pathname,
    plannerGoal,
    selectedCapability,
    selectedModelId,
    selectedOrg,
    selectedReport,
    selectedTask,
    sessionHook.activeSession?.id,
    toolCalls,
  ]);

  const openIssueReport = useCallback(() => {
    setIssueReportState(captureIssueReportState());
    setShowIssueReport(true);
  }, [captureIssueReportState]);

  // Unified thread: the global session store (useChatSessions) owns the
  // message list. Per-page scope (task / capability / planner / report) flows
  // through the per-turn system-prompt blocks, not separate stores. The
  // "New conversation" button is the only way to reset the thread.

  // Garbage-collect IDB attachment blobs that no message references any
  // more. Runs once on mount across all stored sessions — cheap, since the
  // cursor only reads keys.
  useEffect(() => {
    const referenced = new Set<string>();
    for (const m of sessionHook.messages) {
      m.attachments?.forEach((a) => referenced.add(a.id));
    }
    // Pending composer attachments (not yet sent)
    attachments.forEach((a) => referenced.add(a.id));
    purgeOrphans(referenced).catch((err) =>
      console.error("IDB purgeOrphans failed:", err),
    );
    // We intentionally only run this on mount — running on every message
    // change would race with in-flight uploads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const executeClearHistory = () => {
    // Unified thread: the global session store owns the messages. Clearing
    // is just `clearActiveSession()` regardless of scope (task / capability /
    // planner / report); the per-scope system-prompt blocks keep their
    // context on the next turn.
    sessionHook.clearActiveSession();

    setToolCalls([]);

    // Drop the live engine session bound to this scope so the next message
    // starts a fresh runner instead of resuming the old one. rehydrate sees
    // no saved record now, closes SSE/poll, and resets live state to idle.
    const liveScope = currentScopeKeyRef.current;
    clearLiveSession(liveScope);
    rehydrateForScope(liveScope);
  };

  // Process incoming files (from picker or drag-and-drop). Reads each file,
  // persists the blob to IndexedDB, and appends a chip to the composer.
  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    const newAttachments: Attachment[] = [];

    for (const file of list) {
      if (file.size > MAX_SIZE) {
        alert(`File "${file.name}" is too large. Maximum size is 5MB.`);
        continue;
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Persist the blob in IndexedDB so it survives reload and we can
        // re-render the chip from history without keeping base64 in
        // localStorage. The returned `id` is the canonical attachment id.
        let storedId: string;
        try {
          const ref = await putAttachment({
            name: file.name,
            mimeType: file.type,
            size: file.size,
            blob: file,
          });
          storedId = ref.id;
        } catch (idbErr) {
          // IDB unavailable (private mode, quota, etc.) — fall back to
          // a transient id; the message just won't be re-renderable
          // after reload.
          console.error("IDB putAttachment failed:", idbErr);
          storedId = `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }

        newAttachments.push({
          id: storedId,
          name: file.name,
          type: file.type,
          size: file.size,
          data: dataUrl,
          mimeType: file.type,
        });
      } catch (err) {
        console.error("Failed to read file:", err);
        alert(`Failed to read file "${file.name}"`);
      }
    }

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };

  // Handle file selection from the hidden <input type="file">
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await addFiles(files);
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Drag-and-drop handlers on the chat container. We use a counter to
  // survive child-element dragenter/leave bubbling (otherwise the overlay
  // flickers as the cursor moves over inner nodes).
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await addFiles(files);
    }
  };

  // Paste handler: pull image/file blobs straight off the clipboard
  // (e.g. a screenshot copied to the clipboard, or "Copy image" from a
  // browser) and route them through the same addFiles pipeline as
  // drag-drop and the file picker. Only intercept when the clipboard
  // actually carries files — a plain text paste falls through to the
  // textarea's default behavior so typing/pasting text is unaffected.
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const dt = e.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length === 0) return;
    e.preventDefault();
    await addFiles(files);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    // Drop the IDB blob too — the user removed it before sending, so
    // nothing references it any more.
    deleteAttachment(id).catch((err) =>
      console.error("IDB deleteAttachment failed:", err),
    );
  };

  const sendText = useCallback<SendTextFn>(
    (messageContent, currentAttachments = [], options = {}) =>
      // Thin wrapper (phase 1.6b): the full per-backend turn pipeline
      // lives in kody-chat-send.ts. Deps are gathered fresh per call from
      // this memoized closure, so staleness semantics match the
      // pre-extraction inline body (same dependency array below).
      runSendText(
        {
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
          lockedAgentSlug,
          kodyDirectHeaders,
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
        },
        messageContent,
        currentAttachments,
        options,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedTask,
      selectedCapability,
      capabilitySlug,
      isPlannerMode,
      plannerGoal,
      plannerExistingTasks,
      onPlannerTasksCreated,
      setMessagesForSession,
      messages,
      repoAgentSlugs,
      selectedAgentId,
      selectedModelId,
      effectiveReasoningEffort,
      lockedAgentSlug,
      kodyDirectHeaders,
      actorLogin,
      runDashboardNavigateFromDirective,
      sessionHook,
      connectSSE,
    ],
  );
  // Bind the deferred ref now that `sendText` exists. The preview-action
  // dispatcher (declared above to keep stream-handler closure stable) uses
  // this to push synthetic follow-up turns without forward-referencing
  // sendText itself.
  sendTextRef.current = sendText;

  const handleRenderedViewAction = useCallback(
    (view: RenderedViewDirective, action: RenderedViewAction) => {
      if (usedViewIds.has(view.id)) return;
      setUsedViewIds((prev) => {
        const next = new Set(prev);
        next.add(view.id);
        return next;
      });
      const resultPayload = JSON.stringify({
        kind: "view_result",
        view: "renderer",
        viewId: view.id,
        rendererSlug: view.rendererSlug,
        actionId: action.id,
        ...(action.result ? { result: action.result } : {}),
      });
      void sendText(
        `${action.response}\n\n<view_result>${resultPayload}</view_result>`,
        [],
        {
          displayContent: action.result ? action.response : action.label,
        },
      );
    },
    [sendText, usedViewIds],
  );

  // Planner auto-kickoff. The "Plan with chat" button is the user's consent
  // to start; landing them on a blank prompt and asking them to type "go" is
  // a wasted click. We fire Pass 1 automatically on first render of a fresh
  // planner session. Guarded by a ref keyed on sessionId so re-renders,
  // mode toggles, and the "New conversation" button can't re-trigger. The
  // session's message count comes from the global store now (unified thread).
  const plannerAutoKickedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPlannerMode || !plannerSessionId || !plannerGoal) return;
    if (plannerAutoKickedRef.current === plannerSessionId) return;
    if (sessionHook.messages.length > 0) {
      plannerAutoKickedRef.current = plannerSessionId;
      return;
    }
    plannerAutoKickedRef.current = plannerSessionId;
    // Defer one microtask so the chat's setMessages plumbing has committed
    // for this session before sendText reads/writes it.
    void Promise.resolve().then(() => {
      sendText(
        `Plan tasks for the goal "${plannerGoal.name}". Run Pass 1 now: ` +
          "output the proposed task list (3–8 tasks), then wait for my approval.",
      );
    });
  }, [
    isPlannerMode,
    plannerSessionId,
    plannerGoal,
    sessionHook.messages.length,
    sendText,
  ]);

  // Generic switch-agent auto-kickoff. The switch handler stashes an
  // optional kickoff string in `pendingKickoff`; we wait here for the new
  // runner agent AND matching task scope to both land before firing.
  //
  // ORDERING NOTE — this useEffect MUST come after `rehydrateForScope`
  // above. When context first flips from null → task on a fresh issue,
  // rehydrate calls `stopInteractivePoll()` and resets the
  // interactive-session refs to idle/null. If the kickoff fired *first*
  // it would set state to 'booting' and start the poll, then rehydrate
  // would immediately kill the poll and zero the refs — symptom: the
  // Stop button stays stuck (loading=true forever, no chat.done can
  // arrive), composer stays disabled. Running rehydrate first means
  // the kickoff's startInteractiveSession sets up the poll AFTER the
  // reset, so events flow back normally.
  useEffect(() => {
    if (!pendingKickoff) return;
    const isRunner =
      selectedAgentId === "kody-live" || selectedAgentId === "kody-live-fly";
    if (!isRunner) return;
    if (context?.kind !== "task") return;
    // Issue-number gate. If the directive named a specific issue, only
    // fire once the task scope resolves to THAT issue. Otherwise the
    // kickoff goes out the moment we land on the previously-viewed task
    // (cached in tasks query) before the new issue appears in the list.
    if (
      pendingKickoff.issueNumber !== null &&
      context.task.issueNumber !== pendingKickoff.issueNumber
    ) {
      return;
    }
    const kickoffContent = pendingKickoff.content;
    dispatchLive({ type: "KICKOFF_FIRED" });
    void Promise.resolve().then(() => {
      void sendText(kickoffContent);
    });
  }, [pendingKickoff, selectedAgentId, context, sendText, dispatchLive]);

  const sendMessage = () =>
    // Thin wrapper (phase 1.6b): the composer submit path (/init, plugin
    // send-middleware, waiting-instruction route) lives in
    // kody-chat-send.ts. Re-built each render like the old inline
    // async function, so it always sees current composer state.
    runSendMessage({
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
    });

  const handleStop = () => {
    // Cancel every backend the chat can be talking to. Each abort/close
    // is a no-op if that backend wasn't active — calling them all
    // unconditionally keeps the handler simple and the Stop button
    // honest regardless of which agent is selected.
    const activeSessionId = sessionHook.activeSession?.id ?? null;
    eventSourceRef.current?.close();
    if (activeSessionId) {
      kodyAbortBySessionRef.current.get(activeSessionId)?.abort();
      brainAbortBySessionRef.current.get(activeSessionId)?.abort();
    } else {
      kodyAbortRef.current?.abort();
      brainAbortRef.current?.abort();
    }
    setLoading(false);
    setMessages((prev) => {
      const newMessages = [...prev];
      const lastMsg = newMessages[newMessages.length - 1];
      if (lastMsg?.role === "assistant") {
        lastMsg.isLoading = false;
      }
      return newMessages;
    });
  };

  // Composer key/slash/mention handlers (phase 1.6d) — extracted to the
  // useComposerHandlers hook (kody-chat-composer-handlers.ts). State stays
  // here; the hook owns only the handlers. Called after sendMessage /
  // handleStop-adjacent state so the closures see current values.
  const {
    refreshAgentMentionTrigger,
    handleComposerInputChange,
    applyAgentMentionSelection,
    applySlashSelection,
    closeComposerMenus,
    handleKeyDown,
  } = useComposerHandlers({
    chatMode,
    isDesktop,
    input,
    setInput,
    attachments,
    messages,
    activeLoading,
    composerTextareaRef,
    slashCommands,
    slashMenuOpen,
    setSlashMenuOpen,
    slashSelectedIndex,
    setSlashSelectedIndex,
    agentMentionTrigger,
    setAgentMentionTrigger,
    agentMentionSelectedIndex,
    setAgentMentionSelectedIndex,
    filteredAgentMentions,
    sendMessage,
    handleStop,
  });

  // Global ⌘/Ctrl+K toggles the sessions sidebar. Skips when a modifier-less
  // key would interfere with native browser shortcuts.
  useEffect(() => {
    if (!isGlobalMode) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSessionSidebar((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isGlobalMode]);

  // Auto-title sessions once the conversation has substance. Triggers when:
  //   - global mode (per-session sidebar shown)
  //   - the current session still has the default "New conversation" title
  //   - at least one full user → assistant exchange has streamed in
  //   - no reply is currently streaming (avoid mid-stream rename flicker)
  // The title is generated by the user's chat model (/api/kody/chat/title)
  // so it actually summarizes the conversation. A first-message slice is
  // the offline fallback — titling must never block or break the chat.
  const titledSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isGlobalMode || activeLoading) return;
    const session = sessionHook.activeSession;
    if (!session || session.title !== "New conversation") return;
    const firstUser = messages.find((m) => m.role === "user");
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!firstUser || !lastAssistant || !lastAssistant.content.trim()) return;
    const raw = firstUser.content.trim().replace(/\s+/g, " ");
    if (raw.length === 0) return;

    // Guard against the effect re-firing for the same session before the
    // rename has propagated (the LLM round-trip is async).
    if (titledSessionRef.current === session.id) return;
    titledSessionRef.current = session.id;

    const sliceTitle = raw.length > 48 ? `${raw.slice(0, 48).trim()}…` : raw;

    // Title from the USER's messages only. Assistant turns in
    // reasoning-heavy modes (Vibe) carry untagged chain-of-thought as
    // their content; feeding that to the titler makes it continue the
    // reasoning ("The user just said hi — a simple greeting. I need…")
    // instead of summarizing. The user's own words are the clean,
    // reliable intent signal and never contain model reasoning.
    const convo = messages
      .filter((m) => m.role === "user" && m.content.trim().length > 0)
      .map((m) => ({ role: "user" as const, content: m.content }));

    (async () => {
      try {
        const res = await fetch("/api/kody/chat/title", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(kodyDirectHeaders ?? authHeaders()),
          },
          body: JSON.stringify({
            messages: convo,
            ...(selectedModelId ? { model: selectedModelId } : {}),
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { title?: string };
          const generated = data.title?.trim();
          if (generated) {
            sessionHook.renameSession(session.id, generated);
            return;
          }
        }
      } catch {
        // fall through to the slice fallback below
      }
      sessionHook.renameSession(session.id, sliceTitle);
    })();
  }, [
    isGlobalMode,
    activeLoading,
    messages,
    sessionHook,
    selectedModelId,
    kodyDirectHeaders,
  ]);

  // Both `kody-live` (GH Actions) and `kody-live-fly` (Fly Machines) use
  // the same interactive session model, so they share this UI state.
  const isKodyLive =
    selectedAgentId === "kody-live" || selectedAgentId === "kody-live-fly";
  const standalonePresentation = presentation === "standalone";

  // The composer's primary button switches role for Kody Live agents based
  // on whether there's input AND the current session state:
  //   has text          → 'send'  (auto-starts the runner if needed)
  //   empty + idle/end  → 'start' (warm up the runner)
  //   empty + booting   → 'cancel' (abandon the boot attempt)
  //   empty + ready     → 'stop'  (end the live session)
  // For non-Kody-Live agents the button is always 'send' (disabled if empty).
  const hasComposerContent =
    input.trim().length > 0 ||
    (chatMode === "ai" && (attachments.length > 0 || contextChips.length > 0));
  const richComposerEnabled =
    chatMode === "ai" && Boolean(railFullscreen) && isDesktop;
  const composerDisabled =
    chatMode === "ai" &&
    (activeLoading || (isKodyLive && interactiveState !== "ready"));
  type ComposerAction = "send" | "start" | "stop" | "cancel";
  const composerAction: ComposerAction = !isKodyLive
    ? "send"
    : hasComposerContent
      ? "send"
      : interactiveState === "ready"
        ? "stop"
        : interactiveState === "booting"
          ? "cancel"
          : "start";

  // Generate placeholder based on mode. The generic (non-task/capability/draft)
  // case is page-aware: on any sidebar page, hint that Kody can answer about
  // that page — Kody knows every dashboard concept, not just capabilities/tasks.
  // `pageLabel` is derived once at the top of the component.
  const genericPlaceholder = pageLabel
    ? `Ask Kody about ${pageLabel}...`
    : `Ask Kody about any page, capability, or feature...`;
  const placeholder =
    chatMode === "terminal"
      ? "Send command to terminal..."
      : isKodyLive
        ? interactiveState === "idle" || interactiveState === "ended"
          ? "Click Start to warm up the runner."
          : interactiveState === "booting"
            ? selectedAgentId === "kody-live-fly"
              ? "Booting runner — ~45-60s on Fly..."
              : "Booting runner — ~90s on GitHub Actions..."
            : pageLabel
              ? `Ask Kody (live runner) about ${pageLabel}...`
              : "Ask Kody (live runner)..."
        : isKodyWaiting
          ? `Give Kody instructions...`
          : isTaskMode
            ? `Ask about task #${selectedTask?.issueNumber}...`
            : isCapabilityMode
              ? `Ask about capability \`${selectedCapability?.slug ?? ""}\`...`
              : genericPlaceholder;

  return (
    // Surface layout (Phase 1.6e): ChatSurfaceLayout owns the structural
    // JSX (plugin provider mount, drag chrome, waiting banner, footer
    // slot). Every region node below is built HERE so state, handlers,
    // and the per-session agent writes stay in this file.
    <ChatSurfaceLayout
      pluginRegistry={pluginRegistry}
      pluginHost={pluginHost}
      standalonePresentation={standalonePresentation}
      isDraggingFile={isDraggingFile}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sessionsPanel={
        <SessionsPanel
          open={showSessionSidebar}
          isGlobalMode={isGlobalMode}
          pinned={allowSessionSidebarPin && isDesktop && sessionSidebarPinned}
          railFullscreen={railFullscreen}
          standalonePresentation={standalonePresentation}
          sessions={sessionHook.sessions}
          activeSessionId={sessionHook.activeSession?.id || null}
          modeBySessionId={vibeMode ? undefined : terminalModeBySessionId}
          onSwitchSession={(id) => {
            sessionHook.switchSession(id);
          }}
          onCreateSession={() => {
            sessionHook.createSession();
          }}
          onDeleteSession={sessionHook.deleteSession}
          onRenameSession={sessionHook.renameSession}
          onPinSession={sessionHook.pinSession}
          onTogglePinned={
            allowSessionSidebarPin && isDesktop
              ? () => setSessionSidebarPinned((prev) => !prev)
              : undefined
          }
          onClose={() => setShowSessionSidebar(false)}
        />
      }
      voiceOverlay={
        voiceOverlayOpen ? (
          <VoiceChatOverlay
            state={voiceChat.state}
            currentTranscript={voiceChat.currentTranscript}
            turnCount={voiceChat.turnCount}
            error={voiceChat.error}
            ttsEngine={voiceChat.ttsEngine}
            ttsError={voiceChat.ttsError}
            voiceId={voiceId}
            voices={PIPER_VOICES}
            onSelectVoice={handleSelectVoice}
            messages={messages}
            agentName={currentAgent.name}
            onStop={() => {
              voiceChat.stopConversation();
              setVoiceOverlayOpen(false);
              setVoiceMuted(false);
            }}
            onInterrupt={() => {
              voiceChat.interruptConversation();
            }}
            onToggleMute={handleVoiceToggleMute}
            isMuted={voiceMuted}
          />
        ) : null
      }
      header={
        // Header with context — extracted to chat/surface/HeaderControls.
        // Menu open/close state, selection state, and the per-session agent
        // pick stay here; the region is presentation-only.
        <HeaderControls
          currentEntry={currentEntry}
          currentAgent={currentAgent}
          lockedAgentId={lockedAgentId}
          hideAgentPicker={hideAgentPicker}
          compact={compactHeader}
          agentMenuOpen={agentMenuOpen}
          setAgentMenuOpen={setAgentMenuOpen}
          messageCount={messages.length}
          currentReasoning={currentReasoning}
          effectiveReasoningEffort={effectiveReasoningEffort}
          setReasoningEffort={setReasoningEffort}
          reasoningMenuOpen={reasoningMenuOpen}
          setReasoningMenuOpen={setReasoningMenuOpen}
          agentList={agentList}
          selectedAgentId={selectedAgentId}
          selectedModelId={selectedModelId}
          onSelectEntry={(a) => {
            setSelectedAgentId(a.agentId);
            setSelectedModelId(a.modelId);
            // Per-session pick: the same agent stays active when the user
            // comes back to THIS conversation. Each session remembers its
            // own choice — switching to another chat and back restores the
            // agent that was active for that thread, not whichever one the
            // user just clicked.
            //
            // The global `defaultChatEntryKey` is intentionally NOT touched
            // here. Settings → "Default chat" is the single owner of the
            // default for new sessions; the chat picker only mutates the
            // active session.
            const activeId = sessionHook.activeSession?.id;
            if (activeId) {
              sessionHook.setSessionAgent(activeId, a.key);
            }
            setAgentMenuOpen(false);
          }}
          remoteStatus={remoteStatus}
          onNewConversation={() => {
            // Seed the new session with the current effective agent so a
            // fresh conversation inherits the agent the user is currently
            // on. Without this, the new session would have no agentKey and
            // fall back to the global default on first render — which is
            // fine for the very first session but surprises users who
            // expect a "new chat" to start where the last one left off.
            const seed = currentEntry?.key;
            sessionHook.createSession(seed ? { agentKey: seed } : undefined);
            setToolCalls([]);
          }}
          activeLoading={activeLoading}
          showSessionSidebar={showSessionSidebar}
          onToggleSessionSidebar={() =>
            setShowSessionSidebar(!showSessionSidebar)
          }
          onToggleFullscreen={onToggleFullscreen}
          railFullscreen={railFullscreen}
          onCollapseRail={onCollapseRail}
          onClose={onClose}
          isTaskMode={isTaskMode}
          selectedTask={selectedTask}
          isCapabilityMode={isCapabilityMode}
          selectedCapability={selectedCapability}
          isPlannerMode={isPlannerMode}
          plannerGoal={plannerGoal}
          onPlannerExit={onPlannerExit}
          activeSessionTitle={sessionHook.activeSession?.title}
        />
      }
      showKodyWaitingBanner={Boolean(isKodyWaiting && actionState)}
      kodyWaitingStep={actionState?.step}
      messageList={
        <MessageList
          chatMode={chatMode}
          messages={messages}
          setMessages={setMessages}
          onResend={(content) => {
            void sendText(content, []);
          }}
          activeLoading={activeLoading}
          agentName={currentAgent.name}
          activeSessionId={sessionHook.activeSession?.id}
          toolCalls={toolCalls}
          usedViewIds={usedViewIds}
          onRenderedViewAction={handleRenderedViewAction}
          roleLayout={messageRoleLayout}
          emptyState={
            <EmptyState
              isTaskMode={isTaskMode}
              vibeMode={vibeMode}
              selectedTask={selectedTask}
              isCapabilityMode={isCapabilityMode}
              selectedCapability={selectedCapability}
              isPlannerMode={isPlannerMode}
              plannerGoal={plannerGoal}
            />
          }
          terminalSurfaces={terminalSurfaces}
        />
      }
      composer={
        // Composer — extracted to chat/surface/Composer (Step 3). All
        // state (input, slash menu, mentions, attachments, chips, voice)
        // and every handler stay here; the region is presentation-only.
        // The context-chip pills render the ChatRailApi `composerInjection`
        // contract fed through the effect above.
        <Composer
          chatMode={chatMode}
          activeLoading={activeLoading}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          contextChips={contextChips}
          onRemoveContextChip={removeContextChip}
          isKodyLive={isKodyLive}
          interactiveState={interactiveState}
          bootElapsed={bootElapsed}
          selectedAgentId={selectedAgentId}
          interactiveTarget={interactiveTarget}
          liveErrorMessage={liveState.errorMessage}
          onRestartLive={restartInteractiveSession}
          input={input}
          composerTextareaRef={composerTextareaRef}
          richComposerEnabled={richComposerEnabled}
          placeholder={placeholder}
          composerDisabled={composerDisabled}
          onInputChange={handleComposerInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCaretMove={refreshAgentMentionTrigger}
          onMenusClose={closeComposerMenus}
          slashCommandMenu={
            slashMenuOpen ? (
              <SlashCommandMenu
                commands={slashCommands}
                filter={parseSlashTrigger(input).filter}
                selectedIndex={slashSelectedIndex}
                onSelect={applySlashSelection}
                onHover={setSlashSelectedIndex}
              />
            ) : null
          }
          agentMentionsOpen={
            Boolean(agentMentionTrigger) && filteredAgentMentions.length > 0
          }
          agentMentions={filteredAgentMentions}
          agentMentionSelectedIndex={agentMentionSelectedIndex}
          onAgentMentionHover={setAgentMentionSelectedIndex}
          onAgentMentionSelect={applyAgentMentionSelection}
          composerAction={composerAction}
          hasComposerContent={hasComposerContent}
          terminalSendDisabled={terminalSendDisabled}
          terminalSendBusy={terminalSendBusy}
          terminalInputLabel={terminalInputLabel}
          onSend={sendMessage}
          onStop={handleStop}
          onEndLiveSession={endInteractiveSession}
          onStartLiveSession={startInteractiveSession}
          terminalProblemMessage={terminalProblemMessage}
          fileInputRef={fileInputRef}
          onFileSelect={handleFileSelect}
          voiceActive={voiceOverlayOpen}
          voiceSupported={voiceChat.isSupported && currentAgent.supportsVoice}
          onVoiceTap={() => {
            // Handle tap based on current voice state:
            // - If AI is speaking: interrupt and start listening (voice interrupt)
            // - If listening/processing: stop conversation
            // - If idle: start conversation
            if (voiceChat.state === "speaking") {
              // Voice interrupt: cancel AI speech and start listening
              voiceChat.interruptConversation();
              setVoiceOverlayOpen(true);
              setVoiceMuted(false);
            } else if (voiceOverlayOpen) {
              // Already in voice mode - stop it
              voiceChat.stopConversation();
              setVoiceOverlayOpen(false);
              setVoiceMuted(false);
            } else {
              // Not in voice mode - start it
              voiceChat.startConversation();
              setVoiceOverlayOpen(true);
            }
          }}
          onVoiceLongPressStart={() => {
            voiceChat.startConversation();
            setVoiceOverlayOpen(true);
          }}
          onVoiceLongPressEnd={() => {
            /* let conversation handle it */
          }}
          messageCount={messages.length}
          onClearHistory={() => setShowClearConfirm(true)}
          onReportIssue={openIssueReport}
          terminalBottomControls={terminalBottomControls}
          chatModeToggle={chatModeToggle}
        />
      }
      dialogs={
        <>
          <ConfirmDialog
            open={showClearConfirm}
            title="Clear history"
            description="Clear conversation history? This cannot be undone."
            confirmLabel="Clear"
            variant="destructive"
            onConfirm={executeClearHistory}
            onClose={() => setShowClearConfirm(false)}
          />
          <ChatIssueReportDialog
            open={showIssueReport}
            onClose={() => setShowIssueReport(false)}
            capturedState={issueReportState}
          />
        </>
      }
    />
  );
}
