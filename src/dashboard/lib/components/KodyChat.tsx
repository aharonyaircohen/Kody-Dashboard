"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { navLabelForPath } from "./settings-nav";
import {
  liveReducer,
  initialLiveState,
  isWatchdogActive,
  type LivePhase,
  type LiveAction,
  type LiveSessionState,
} from "../chat/core/kody-chat-reducer";
import { FileText, FileCode } from "lucide-react";
import { AGENT_KODY, AGENTS, type AgentId } from "../agents";
import {
  buildAgentList,
  shouldWaitForModelBackedEntryResolution,
  type ChatDropdownEntry,
  type ChatModelEntry,
} from "../chat/platform/agent-entries";
import {
  createChatPluginRegistry,
  FULL_GRANT,
  type ChatHostEffect,
} from "../chat/platform";
import {
  ChatPluginProvider,
  ChatPluginSlot,
} from "../chat/surface/ChatPluginProvider";
import {
  repoBrainConversationKey,
  repoBrainScopeKey,
} from "../brain/repo-scope";
import { readDefaultChatEntry } from "../chat/platform/default-entry";
import {
  readReasoningEffort,
  resolveEffort,
} from "../chat/core/reasoning-pref";
import { getStoredAuth, getStoredBrainConfig, getStoredFlyPerf } from "../api";
import { useAuth } from "../auth-context";
import { toast } from "sonner";
import type { KodyTask } from "../types";
import {
  LOCAL_TERMINAL_TRANSPORT,
  TERMINAL_DISPLAY_MODE,
  TerminalBottomControls,
  TerminalModeToggle,
  TerminalTopControls,
  checkpointTransportFromChatTransport,
  readTerminalIntentEffect,
  shouldLoadTerminalCheckpoint,
  terminalCheckpointLoadKey,
  terminalCheckpointSearchParams,
  terminalChatPlugin,
  useBrainImageSave,
  useChatTerminalRegistry,
  ChatTerminalSurface,
  type ChatTerminalMode,
  type ChatTerminalChromeState,
  type ChatTerminalSnapshot,
  type ChatTerminalTransport,
  type ChatTerminalSurfaceHandle,
  type TerminalIntentEffectPayload,
} from "../chat/plugins/terminal";
import {
  SlashCommandMenu,
  commandsChatPlugin,
  filterCommands,
  parseSlashTrigger,
  readSlashExpansionEffect,
  useSlashCommands,
  type SlashExpansionEffectPayload,
} from "../chat/plugins/commands";
import {
  goalsChatPlugin,
  readGoalDirectEffect,
  type GoalDirectEffectPayload,
} from "../chat/plugins/goals";
import { useElementPicker } from "../picker/useElementPicker";
import { formatPageInfo } from "../picker/protocol";
import { runPreviewAction } from "../picker/run-preview-action";
import { formatMacrosCatalog, type Macro } from "../macros";
import {
  authHeaders,
  stickyBrainChatId,
  isBrainChatPinned,
  getLiveScopeKey,
  loadLiveSession,
  saveLiveSession,
  clearLiveSession,
  liveAuthFor,
  liveAuthHeaders,
  brainHeaders,
  type LiveScopeKey,
} from "../chat/core/kody-chat-live-session";
import {
  buildRehydrateAction,
  decideLivePersistence,
  shouldRehydrateScope,
} from "../chat/core/rehydration";
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
import { createTransportTurnHandler } from "./kody-chat-transport-events";
import {
  composeUserWireContent,
  formatFileSize,
  shouldCollectPreviewContextForTurn,
} from "./kody-chat-helpers";
import { formatAttachmentForTextBackend } from "../chat/core/attachment-text";
import {
  chatToMessage,
  messageToChat,
  type Message,
  type ToolCall,
  type Attachment,
  type KodyChatProps,
} from "./kody-chat-types";
import { flushSync } from "react-dom";
import type {
  AttachmentRef,
  ChatContext,
  ChatMessage,
  ChatSession,
} from "../chat-types";
import {
  putAttachment,
  getAttachmentDataUrl,
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
import { useVoiceChat } from "../hooks/useVoiceChat";
import { extractSentences } from "@dashboard/lib/speech-helpers";
import {
  PIPER_VOICES,
  DEFAULT_VOICE_ID,
  loadVoicePreference,
  saveVoicePreference,
} from "@dashboard/lib/voice/voices";
import { VoiceChatOverlay } from "./VoiceChatOverlay";
import { useChatSessions } from "../chat/core/use-chat-sessions";
import { useKodyActionState } from "../hooks/useKodyActionState";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { SessionsPanel } from "../chat/surface/SessionsPanel";
import { HeaderControls } from "../chat/surface/HeaderControls";
import { MessageList } from "../chat/surface/MessageList";
import { Composer } from "../chat/surface/Composer";
import { parseReasoning, stripReasoning } from "../chat/core/reasoning";
import {
  extractFirstStaffMentionCandidate,
  extractStaffMentions,
  parseStaffMentionTrigger,
  replaceStaffMentionTrigger,
  type StaffMentionTrigger,
} from "../mentions/agent-mentions";
import {
  pickVibeRequestIssueNumber,
  vibeChatPlugin,
  vibeLiveTaskContext,
  vibeTurnFields,
  VIBE_TASK_EMPTY_STATE_HINT,
  type RecentVibeIssue,
} from "../chat/plugins/vibe";
import {
  isDashboardNavigateDirective,
  isPreviewActDirective,
  isSwitchAgentDirective,
  type DashboardNavigateDirective,
  type RenderedViewAction,
  type RenderedViewDirective,
  type PreviewActDirective,
} from "@dashboard/lib/chat-ui-actions";
import { repoScopedHref } from "@dashboard/lib/routes";
import { SHOW_VIEW_TOOL } from "@dashboard/lib/chat-output-tools";
import {
  terminalCheckpointLabel,
  type TerminalCheckpoint,
} from "@dashboard/lib/terminal/checkpoint-types";
import { extractKodyTerminalPayload } from "@dashboard/lib/terminal/kody-terminal-directive";

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
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>(
    lockedAgentId ?? "kody-live",
  );
  // When the user picks a gateway-routed model (any LLM_MODELS entry), the
  // dropdown sets `selectedAgentId='kody'` and stashes the gateway id here.
  // The chat request forwards it as `body.model`. Null = no override.
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  // ─── Chat plugin platform (Step 4) ───
  // One registry PER MOUNT (plan H4: ChatRailShell mounts KodyChat twice;
  // plugin manifests are global pure data, instantiation is per mount).
  // `plugins`/`capabilityGrant` are mount-time config — read once in the
  // useState initializer, never re-registered on re-render. The terminal
  // plugin (Step 5a) registers by default; `hideTerminalMode` surfaces
  // (ClientChatSurface) skip it, so they carry no terminal display mode or
  // terminal-intent middleware. The commands plugin (Step 5b) registers on
  // every surface — slash expansion ran unconditionally before the move.
  // The vibe plugin (Step 5c) also registers on every surface: its manifest
  // is contribution-free (vibe is a HOST mode — see plugins/vibe/index.ts),
  // and behavior stays gated on the `vibeMode` prop, which can flip
  // mid-mount as the persistent rail navigates onto/off /vibe.
  // The goals plugin (Step 5d) registers only when the host can route
  // goals (`onDirectToGoal` supplied — ChatRailShell's two mounts; the
  // client surface and GoalControl's planner dialog never pass it, so
  // they carry no goal-mention middleware). Prop PRESENCE is stable per
  // surface, so the mount-time read is safe.
  // With no plugins at all the registry is inert: slots render nothing and
  // the send-middleware chain passes through.
  const [pluginRegistry] = useState(() => {
    const registry = createChatPluginRegistry();
    const grant = capabilityGrant ?? FULL_GRANT;
    const entries = [
      ...(hideTerminalMode ? [] : [{ plugin: terminalChatPlugin }]),
      { plugin: commandsChatPlugin },
      { plugin: vibeChatPlugin },
      ...(onDirectToGoal ? [{ plugin: goalsChatPlugin }] : []),
      ...(plugins ?? []),
    ];
    for (const entry of entries) {
      registry.register(entry.plugin, grant);
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
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  // Thinking-level state. The chat header shows a small `🧠` dropdown
  // next to the agent picker when the current model declares a
  // `reasoning` block (or one can be auto-detected from `modelName`).
  // The pick is persisted per (repo, modelId) so switching models
  // doesn't reset your "High" on Claude when you swap to GPT-5. Sent
  // on every chat request as `body.reasoningEffort`; the chat route
  // translates it to the provider's wire shape at request time.
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
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
  // Brain visibility is driven exclusively by the per-user Settings entry
  // (URL + API key in localStorage). A server-wide `BRAIN_CHAT_URL` env on
  // the deployment used to also surface the row, but that meant every
  // user of the deployment saw "Kody Brain" whether they'd configured it
  // or not — confusing, and pickable into a 401 loop. Settings is now the
  // single source of truth for whether the row appears.
  const brainConfigured = Boolean(auth?.brain?.url && auth?.brain?.apiKey);
  // Mirrors brainConfigured: true only when the per-repo vault holds a
  // non-empty FLY_API_TOKEN. The Fly dropdown row is hidden until then so
  // users can't pick a runner that will fail at start-fly time.
  const [flyConfigured, setFlyConfigured] = useState(false);
  // Per-repo opt-in for the "Repo Brain" chat row (state repo dashboard.json,
  // default false). Chat-only — does NOT gate Fly task execution.
  const [brainFlyChatEnabled, setBrainFlyChatEnabled] = useState(false);
  // User-managed chat models from /api/kody/models (LLM_MODELS variable).
  // Empty until first load completes; renders only Kody Live (+ Brain) in
  // the dropdown while empty.
  const [chatModels, setChatModels] = useState<ChatModelEntry[]>([]);
  const [chatModelsLoaded, setChatModelsLoaded] = useState(false);
  // The user-chosen default chat dropdown entry key (any entry: Brain,
  // Brain-Fly, or `kody:<modelId>`), a per-user preference persisted in
  // localStorage (repo-scoped). Read synchronously on mount. Separate from a
  // model's own `default` flag, which governs server-side gateway resolution.
  // Read on mount here; written by Settings → "Default chat". The chat picker
  // stores per-session picks separately.
  const [defaultChatEntryKey] = useState<string | null>(() =>
    readDefaultChatEntry(),
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
  type SendTextFn = (
    messageContent: string,
    currentAttachments?: Attachment[],
    options?: {
      voiceMode?: boolean;
      hidden?: boolean;
      // Voice streaming: called as the reply grows, with the full spoken
      // text so far (reasoning/<think> stripped). Lets the caller speak
      // sentence-by-sentence instead of waiting for the whole reply.
      onVoiceDelta?: (spokenSoFar: string) => void;
    },
  ) => Promise<string | null>;
  const sendTextRef = useRef<SendTextFn | null>(null);
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
  const currentAgent = AGENTS[selectedAgentId] ?? AGENT_KODY;
  const agentList = buildAgentList(
    brainConfigured,
    flyConfigured,
    brainFlyChatEnabled,
    chatModels,
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
  // What to show in the header — when a gateway model is active, prefer
  // its label over the static `kody` agent name.
  const currentEntry =
    agentList.find(
      (e) =>
        e.agentId === selectedAgentId &&
        (e.modelId ?? null) === selectedModelId,
    ) ?? null;
  // Effective thinking config for the active model. `null` when the model
  // has no `reasoning` block AND the model-name auto-detect couldn't pick
  // one — the header hides the dropdown in that case (no clutter for
  // models that don't reason).
  const currentReasoning = currentEntry?.reasoning ?? null;
  // Resolved effort. Read directly from localStorage on every render so
  // the dropdown never flashes the model's `default` before snapping to
  // the stored pick on mount. The `reasoningEffort` state still wins
  // during the current session (overrides the storage read with the
  // user's just-clicked pick before the localStorage write is observed
  // by React's next render). Per-(repo, modelId) scoping lives in
  // `reasoning-pref.ts`.
  const effectiveReasoningEffort = useMemo(() => {
    if (!currentReasoning) return null;
    if (
      reasoningEffort &&
      currentReasoning.efforts.some((e) => e.value === reasoningEffort)
    ) {
      return reasoningEffort;
    }
    if (selectedModelId) {
      const stored = readReasoningEffort(selectedModelId);
      if (stored && currentReasoning.efforts.some((e) => e.value === stored)) {
        return stored;
      }
    }
    return currentReasoning.default;
  }, [currentReasoning, selectedModelId, reasoningEffort]);

  // Load the user-managed model list once on mount. The dropdown stays in
  // Kody Live-only mode until this resolves; failures are silent — chat
  // still works through the engine path.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/kody/models", { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json: { models?: ChatModelEntry[] }) => {
        if (cancelled) return;
        setChatModels(Array.isArray(json.models) ? json.models : []);
        setChatModelsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setChatModels([]);
          setChatModelsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the repo-wide Repo Brain chat toggle once on mount. The default
  // chat entry is no longer fetched here — it's a per-user localStorage
  // preference, read synchronously into state above. Silent on failure.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/kody/dashboard-config", { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(
        (json: {
          config?: {
            brainFlyChatEnabled?: boolean;
          };
        }) => {
          if (cancelled) return;
          setBrainFlyChatEnabled(json.config?.brainFlyChatEnabled === true);
        },
      )
      .catch(() => {
        if (!cancelled) setBrainFlyChatEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the global default agent entry — the value a session with
  // no per-session pick falls back to. Used as the catch-all when
  // a session's `agentKey` is missing (legacy sessions created
  // before this field existed) or points at an entry that has
  // since been removed from the list.
  //
  // Resolution order:
  //   1. `defaultChatEntryKey` — Settings → "Default chat" pick.
  //   2. Legacy: a Kody model with `default: true` on the Models page.
  //   3. First configured Kody model.
  //   4. Brain if configured.
  //   5. First valid Live entry (Kody Live, or Live-Fly when on Fly).
  //
  // Renderers are part of the in-process Kody chat protocol. If a repo has
  // a Kody model configured but no saved default, default to that renderer-
  // capable path instead of Live, while still letting Settings override it.
  const defaultAgentEntry = useMemo<ChatDropdownEntry | null>(() => {
    if (defaultChatEntryKey) {
      const entry = agentList.find((e) => e.key === defaultChatEntryKey);
      if (entry) return entry;
    }
    const defModel = chatModels.find(
      (m) => m.default === true && m.enabled !== false,
    );
    if (defModel) {
      const entry = agentList.find((e) => e.key === `kody:${defModel.id}`);
      if (entry) return entry;
    }
    const firstKodyModel = agentList.find((e) => e.agentId === "kody");
    if (firstKodyModel) return firstKodyModel;
    if (brainConfigured) {
      const entry = agentList.find(
        (e) => e.key === "brain" || e.key === "brain-fly",
      );
      if (entry) return entry;
    }
    return (
      agentList.find(
        (e) => e.key === "kody-live-fly" || e.key === "kody-live",
      ) ??
      agentList[0] ??
      null
    );
  }, [defaultChatEntryKey, chatModels, brainConfigured, agentList]);

  // Family snap. When a probe flips availability (Fly token added/removed,
  // Brain Fly toggle flipped), a session's `agentKey` may point at a
  // dropdown row that's no longer in the list. The same agent is still
  // available under a sibling key (Live ↔ Live-Fly, Brain ↔ Brain-Fly);
  // use that instead of bouncing the user back to a different family.
  // For removed gateway models, fall back to any other Kody row, then
  // Live if no Kody rows exist.
  const familySnap = useCallback(
    (key: string): ChatDropdownEntry | null => {
      if (key === "kody-live" || key === "kody-live-fly") {
        return (
          agentList.find(
            (e) => e.key === "kody-live-fly" || e.key === "kody-live",
          ) ?? null
        );
      }
      if (key === "brain" || key === "brain-fly") {
        return (
          agentList.find((e) => e.key === "brain-fly" || e.key === "brain") ??
          null
        );
      }
      if (key.startsWith("kody:")) {
        return (
          agentList.find((e) => e.agentId === "kody") ??
          agentList.find(
            (e) => e.key === "kody-live-fly" || e.key === "kody-live",
          ) ??
          null
        );
      }
      return null;
    },
    [agentList],
  );

  // Probe the per-repo vault for FLY_API_TOKEN so the dropdown can hide the
  // Fly row when no token is configured. Silent on any error — the row just
  // stays hidden, matching the "not configured" state.
  useEffect(() => {
    let cancelled = false;
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) {
      setFlyConfigured(false);
      return;
    }
    fetch("/api/kody/secrets/FLY_API_TOKEN/value", { headers })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setFlyConfigured(false);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { value?: string };
        setFlyConfigured(Boolean(body.value && body.value.trim().length > 0));
      })
      .catch(() => {
        if (!cancelled) setFlyConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When a parent toggles `lockedAgentId` on/off (route change), keep state in sync.
  useEffect(() => {
    if (lockedAgentId && selectedAgentId !== lockedAgentId) {
      setSelectedAgentId(lockedAgentId);
    }
  }, [lockedAgentId, selectedAgentId]);

  // Restore an in-progress Kody Live session after a page refresh. Reads
  // localStorage on mount; if a non-stale session exists, switches to the
  // live agent, restores state, and reconnects the SSE so chat.ready /
  // chat.message / chat.exit continue to flow. Runs once.
  const liveRestoreAttemptedRef = useRef(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showIssueReport, setShowIssueReport] = useState(false);
  const [issueReportState, setIssueReportState] =
    useState<ChatIssueReportState | null>(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  // Per-user Piper voice choice. Starts at the default to keep SSR/first
  // render deterministic, then hydrates from localStorage after mount.
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_ID);
  useEffect(() => {
    setVoiceId(loadVoicePreference());
  }, []);
  const handleSelectVoice = useCallback((id: string) => {
    setVoiceId(id);
    saveVoicePreference(id);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Kody Live (long-lived runner) lifecycle — single reducer owns phase +
  // session id + target + run url + boot timestamp + last-event timestamp +
  // the vibe auto-kickoff queue. Every transition goes through `dispatchLive`,
  // which (a) recomputes the next state, (b) writes a synchronous mirror to
  // `liveStateRef` so closure-captured reads see fresh values immediately,
  // and (c) calls React's setState so the UI re-renders. See
  // kody-chat-reducer.ts for the action surface and transition table.
  //
  // Legacy phases ('idle' | 'booting' | 'ready' | 'ended') are extended with
  // 'awaiting' (turn in flight), 'error' (start failed or chat.error), and
  // 'stuck' (watchdog/status check declared the runner zombie).
  const liveStateRef = useRef<LiveSessionState>(initialLiveState);
  const [liveState, setLiveState] =
    useState<LiveSessionState>(initialLiveState);
  const dispatchLive = useCallback((action: LiveAction) => {
    const next = liveReducer(liveStateRef.current, action);
    liveStateRef.current = next;
    setLiveState(next);
    // Keep the legacy named refs in sync so closure readers don't go stale.
    interactiveSessionIdRef.current = next.sessionId;
    interactiveStateRef.current = next.phase;
    interactiveTargetRef.current = next.target;
    currentScopeKeyRef.current = next.scopeKey;
  }, []);

  // Legacy refs kept for the many closure readers in this file. Source of
  // truth is `liveStateRef`; these are updated by `dispatchLive` above so
  // a post-dispatch read in the same tick sees the new value.
  const interactiveSessionIdRef = useRef<string | null>(null);
  const interactiveStateRef = useRef<LivePhase>("idle");
  // The vibe issue this chat JUST created (set in the issue-creation transfer
  // below). Used to scope the immediately-following turns to that issue while
  // the page's task scope (context.kind === "task") catches up — without it,
  // the turn right after creation carries no issue and the server can't bind
  // the runner hand-off to the right one. See chat/plugins/vibe/recent-issue.ts.
  const recentVibeIssueRef = useRef<RecentVibeIssue | null>(null);
  const interactiveTargetRef = useRef<{ owner: string; repo: string } | null>(
    null,
  );
  const currentScopeKeyRef = useRef<LiveScopeKey>("global");

  // Render aliases — kept named to minimise churn at JSX read sites.
  const interactiveState = liveState.phase;
  const interactiveTarget = liveState.target;
  const interactiveRunUrl = liveState.runUrl;
  const pendingKickoff = liveState.pendingKickoff;

  // Boot-elapsed ticker — drives the banner countdown while booting.
  const [bootElapsed, setBootElapsed] = useState(0);
  useEffect(() => {
    if (liveState.phase !== "booting" || !liveState.bootStartedAt) {
      setBootElapsed(0);
      return;
    }
    const tick = () =>
      setBootElapsed(
        Math.floor(
          (Date.now() - (liveState.bootStartedAt ?? Date.now())) / 1000,
        ),
      );
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [liveState.phase, liveState.bootStartedAt]);

  // Persist the live-session record to localStorage whenever the reducer
  // moves through booting/ready, and clear it when we leave those phases.
  // Centralising the persistence here means start/ready/exit/error/stuck
  // all share one storage path — fixes a previous foot-gun where some
  // mutation sites forgot to save or clear.
  //
  // CRITICAL: on first mount, the reducer is in its initial { phase: 'idle',
  // sessionId: null } state. The rehydrate effect (further down) reads
  // localStorage and dispatches REHYDRATE_RESTORED. If THIS effect ran on
  // mount and called clearLiveSession, it would wipe the saved record
  // BEFORE rehydrate gets to read it — symptom: refresh-during-session
  // loses the session. We skip the initial-idle case via a ref, only
  // clearing on a genuine transition INTO idle/ended/etc.
  const persistenceMountedRef = useRef(false);
  useEffect(() => {
    // Decision logic lives in chat/core/rehydration.ts (pure, unit-tested);
    // this effect only performs the storage side effects it prescribes.
    const decision = decideLivePersistence(
      liveState,
      persistenceMountedRef.current,
    );
    switch (decision.kind) {
      case "save":
        saveLiveSession(decision.scopeKey, decision.record);
        persistenceMountedRef.current = true;
        return;
      case "skip-initial":
        // First render with idle/null state — leave any persisted record
        // alone; the rehydrate effect below will pick it up.
        persistenceMountedRef.current = true;
        return;
      case "clear":
        clearLiveSession(decision.scopeKey);
        return;
      case "none":
        return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    liveState.phase,
    liveState.sessionId,
    liveState.scopeKey,
    liveState.bootStartedAt,
    liveState.target,
    liveState.runUrl,
  ]);

  // Remote dev status (only polls when actorLogin is provided)
  const { data: remoteStatus } = useRemoteStatus(actorLogin);

  // Session sidebar state (for session management feature)
  const [showSessionSidebar, setShowSessionSidebar] = useState(false);
  const previousRailFullscreenRef = useRef(railFullscreen);
  const [sessionSidebarPinned, setSessionSidebarPinned] = useState(() => {
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
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "kody-chat:sessions-panel-pinned",
      sessionSidebarPinned ? "1" : "0",
    );
    if (sessionSidebarPinned) setShowSessionSidebar(true);
  }, [sessionSidebarPinned]);

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

  // Per-session agent sync. The active session's `agentKey` is the
  // source of truth for the visible agent — switching sessions
  // restores the agent that was active for that thread, and the
  // user's picker write is captured on the session.
  //
  // Three flows collapse into one effect:
  //   1. Session has a valid `agentKey` → adopt it. (Covers session
  //      switches, where the active session changes underneath us.)
  //   2. Session's `agentKey` points at an entry that's no longer
  //      in the list (e.g. FLY_API_TOKEN probe flipped, or the user
  //      removed the model on the Models page) → family snap to
  //      a sibling entry, then default chain.
  //   3. Session has no `agentKey` (legacy session) → use the
  //      default chain and write it back so the next switch
  //      restores it directly. Also covers the "no active session"
  //      case, where the local state is just seeded with the default
  //      (the first send then auto-creates a session and the sync
  //      effect will re-run to capture the pick).
  useEffect(() => {
    if (lockedAgentId) return; // Vibe page owns the agent
    const session = sessionHook.activeSession;
    if (
      shouldWaitForModelBackedEntryResolution({
        sessionHydrated: sessionHook.hydrated,
        chatModelsLoaded,
        sessionAgentKey: session?.agentKey,
      })
    ) {
      return;
    }
    if (agentList.length === 0) return; // Wait for the list to load.

    let targetEntry: ChatDropdownEntry | null = null;
    if (session?.agentKey) {
      targetEntry = agentList.find((e) => e.key === session.agentKey) ?? null;
      if (!targetEntry) {
        targetEntry = familySnap(session.agentKey);
      }
    }
    if (!targetEntry) {
      targetEntry = defaultAgentEntry;
    }
    if (!targetEntry) return;

    if (
      targetEntry.agentId !== selectedAgentId ||
      (targetEntry.modelId ?? null) !== selectedModelId
    ) {
      setSelectedAgentId(targetEntry.agentId);
      setSelectedModelId(targetEntry.modelId);
    }

    // Persist the resolved pick on the active session so future
    // switches restore it directly without re-running the fallback
    // chain. Skipped when there's no session (local-state-only
    // adjustment) or when the session already has this key.
    if (session && session.agentKey !== targetEntry.key) {
      sessionHook.setSessionAgent(session.id, targetEntry.key);
    }
  }, [
    sessionHook.activeSession?.id,
    sessionHook.activeSession?.agentKey,
    sessionHook.hydrated,
    agentList,
    defaultAgentEntry,
    familySnap,
    chatModelsLoaded,
    lockedAgentId,
    selectedAgentId,
    selectedModelId,
    sessionHook.setSessionAgent,
  ]);

  // Reset the visible stream state on agent switch. Session switches are
  // intentionally allowed while a reply is running; each send now writes
  // back to the session id it started from.
  const activeSessionIdForReset = sessionHook.activeSession?.id ?? null;
  const terminalRegistry = useChatTerminalRegistry({
    activeSessionId: activeSessionIdForReset,
    createSession: createChatSession,
    sessions: sessionHook.sessions,
    sessionsHydrated: sessionHook.hydrated,
    storageScope: sessionStoreScope,
  });
  // Display-mode arbitration (plan H2d): the terminal plugin DECLARES the
  // "terminal" mode; the platform resolves it. Vibe is a HOST mode — the
  // host forces "ai", which always wins, so vibe-suppresses-terminal never
  // becomes a plugin→plugin import. With the terminal plugin unregistered
  // (hideTerminalMode) the mode can never resolve to "terminal".
  const resolvedDisplayMode = pluginRegistry.resolveDisplayMode(
    [terminalRegistry.mode],
    vibeMode ? "ai" : undefined,
  );
  const chatMode: ChatTerminalMode =
    resolvedDisplayMode === TERMINAL_DISPLAY_MODE ? "terminal" : "ai";
  const terminalMachines = terminalRegistry.terminalMachines;
  const activeTerminalTransport = terminalRegistry.activeTransport;
  const activeTerminalInstanceId = terminalRegistry.activeInstanceId;
  const activeTerminalValue = terminalRegistry.activeTargetValue;
  const activeTerminalConnectionState = terminalRegistry.activeConnectionState;
  const mountedChatTerminals = terminalRegistry.mountedTerminals;
  const flyInventoryLoading = terminalRegistry.flyInventoryLoading;
  const flyInventoryError = terminalRegistry.flyInventoryError;
  const setActiveChatMode = terminalRegistry.setActiveMode;
  const refreshChatTerminalFlyMachines = terminalRegistry.refreshFlyMachines;
  const handleTerminalTargetChange = terminalRegistry.selectTarget;
  const recordTerminalConnectionState = terminalRegistry.recordConnectionState;
  const activeSessionHasLiveTerminal = terminalRegistry.hasLiveTerminal(
    activeSessionIdForReset,
  );
  const terminalStatusLabel =
    activeTerminalConnectionState === "connected"
      ? "On"
      : activeTerminalConnectionState === "connecting"
        ? "Starting"
        : "Off";
  // Brain image save action + status (plugin hook — called here so a save
  // keeps polling while the user leaves terminal mode).
  const brainImageSave = useBrainImageSave();
  const [pendingTerminalRestore, setPendingTerminalRestore] =
    useState<TerminalCheckpoint | null>(null);
  const [pendingKodyTerminalPayload, setPendingKodyTerminalPayload] = useState<
    string | null
  >(null);
  const loadedTerminalCheckpointKeyRef = useRef<string | null>(null);

  const loadTerminalCheckpoint = useCallback(
    async (transport: ChatTerminalTransport, chatSessionId: string) => {
      const headers = authHeaders();
      if (Object.keys(headers).length === 0) return;
      try {
        const res = await fetch(
          `/api/kody/chat/terminal/checkpoint${terminalCheckpointSearchParams(
            actorLogin,
            transport,
            chatSessionId,
          )}`,
          { headers },
        );
        const body = (await res.json().catch(() => ({}))) as {
          checkpoint?: TerminalCheckpoint | null;
          message?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
        }
        if (body.checkpoint?.output?.trim()) {
          setPendingTerminalRestore(body.checkpoint);
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to load terminal checkpoint",
        );
      }
    },
    [actorLogin],
  );
  useEffect(() => {
    if (!activeSessionIdForReset) return;
    const checkpointKey = terminalCheckpointLoadKey({
      actorLogin,
      activeSessionId: activeSessionIdForReset,
      activeTargetValue: activeTerminalValue,
    });
    if (
      !shouldLoadTerminalCheckpoint({
        chatMode,
        activeSessionId: activeSessionIdForReset,
        hasLiveTerminal: activeSessionHasLiveTerminal,
        loadedKey: loadedTerminalCheckpointKeyRef.current,
        nextKey: checkpointKey,
      })
    ) {
      return;
    }
    loadedTerminalCheckpointKeyRef.current = checkpointKey;
    void loadTerminalCheckpoint(
      activeTerminalTransport,
      activeSessionIdForReset,
    );
  }, [
    activeSessionIdForReset,
    activeTerminalTransport,
    activeTerminalValue,
    activeSessionHasLiveTerminal,
    actorLogin,
    chatMode,
    loadTerminalCheckpoint,
  ]);
  useEffect(() => {
    loadedTerminalCheckpointKeyRef.current = null;
  }, [sessionStoreScope]);

  const saveTerminalCheckpoint = useCallback(
    async (
      terminal: { sessionId: string; transport: ChatTerminalTransport },
      snapshot: ChatTerminalSnapshot,
    ) => {
      if (!snapshot.output.trim()) return false;
      try {
        const res = await fetch("/api/kody/chat/terminal/checkpoint", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            actorLogin,
            transport: checkpointTransportFromChatTransport(terminal.transport),
            chatSessionId: terminal.sessionId,
            cwd: snapshot.cwd,
            shell: snapshot.shell,
            output: snapshot.output,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          checkpoint?: TerminalCheckpoint;
          message?: string;
          error?: string;
        };
        if (!res.ok || !body.checkpoint) {
          throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
        }
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to save terminal checkpoint",
        );
        return false;
      }
    },
    [actorLogin],
  );

  const sendKodyTerminalPayloadToTerminal = useCallback(
    (payload: string) => {
      const terminalPayload = payload.trimEnd();
      if (!terminalPayload.trim()) {
        toast.error("Kody returned an empty terminal payload");
        return false;
      }
      const payloadWithEnter = `${terminalPayload}\n`;
      terminalRegistry.openTerminalMode(LOCAL_TERMINAL_TRANSPORT);

      if (
        activeTerminalTransport.type === "local" &&
        activeTerminalInstanceId &&
        activeTerminalConnectionState === "connected"
      ) {
        const terminal = terminalSurfaceRefs.current[activeTerminalInstanceId];
        if (terminal?.executeText(payloadWithEnter)) {
          terminal.focus();
          toast.success("Sent to terminal");
          return true;
        }
      }

      setPendingKodyTerminalPayload(payloadWithEnter);
      return true;
    },
    [
      activeTerminalConnectionState,
      activeTerminalInstanceId,
      activeTerminalTransport.type,
      terminalRegistry,
    ],
  );

  useEffect(() => {
    if (!pendingKodyTerminalPayload) return;
    if (chatMode !== "terminal") return;
    if (activeTerminalTransport.type !== "local") return;
    if (!activeTerminalInstanceId) return;
    if (activeTerminalConnectionState !== "connected") return;

    const terminal = terminalSurfaceRefs.current[activeTerminalInstanceId];
    if (!terminal?.executeText(pendingKodyTerminalPayload)) return;

    setPendingKodyTerminalPayload(null);
    terminal.focus();
    toast.success("Sent to terminal");
  }, [
    activeTerminalConnectionState,
    activeTerminalInstanceId,
    activeTerminalTransport.type,
    chatMode,
    pendingKodyTerminalPayload,
  ]);
  const handleTerminalTargetSelect = useCallback(
    (value: string) => {
      handleTerminalTargetChange(value);
    },
    [handleTerminalTargetChange],
  );
  useEffect(() => {
    if (desiredSessionScope === sessionStoreScope) return;
    const t = setTimeout(() => setSessionStoreScope(desiredSessionScope), 150);
    return () => clearTimeout(t);
  }, [desiredSessionScope, sessionStoreScope]);
  const terminalSurfaceRefs = useRef<
    Record<string, ChatTerminalSurfaceHandle | null>
  >({});
  const [terminalChromeById, setTerminalChromeById] = useState<
    Record<string, ChatTerminalChromeState>
  >({});
  const activeTerminalChrome = activeTerminalInstanceId
    ? terminalChromeById[activeTerminalInstanceId]
    : null;

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
  }, [activeSessionIdForReset, selectedAgentId]);

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
    if (railFullscreen && isGlobalMode) {
      setShowSessionSidebar(true);
    }
  }, [railFullscreen, isGlobalMode]);

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

  const addTerminalContextToChat = useCallback(
    (context: string) => {
      setContextChips((prev) => [
        ...prev,
        {
          id: `terminal-output-${Date.now()}`,
          label: "Terminal output",
          context,
        },
      ]);
      setActiveChatMode("ai");
      toast.success("Terminal output added to next chat message");
    },
    [setActiveChatMode],
  );

  const openTerminalMode = useCallback(() => {
    terminalRegistry.openTerminalMode();
    setSlashMenuOpen(false);
  }, [terminalRegistry]);

  useEffect(() => {
    if (
      !pendingTerminalRestore ||
      chatMode !== "terminal" ||
      !activeTerminalInstanceId
    ) {
      return;
    }
    const terminal = terminalSurfaceRefs.current[activeTerminalInstanceId];
    if (!terminal) return;
    terminal.restoreSnapshot({
      name: `${terminalCheckpointLabel(
        pendingTerminalRestore.transport,
      )} checkpoint`,
      output: pendingTerminalRestore.output,
    });
    setPendingTerminalRestore(null);
    toast.success("Terminal checkpoint restored");
  }, [activeTerminalInstanceId, chatMode, pendingTerminalRestore]);

  // ─── Polling for Kody Live ─────────────────────────────────────────────────
  // Plain fixed-interval poll of /api/kody/events/poll. We tried real-time
  // push (engine HttpSink → /ingest → in-memory bus) but Vercel's per-
  // function-instance bus made it unreliable. Polling at 3s with ETag
  // caching on the server is simple and well-understood: most polls hit
  // GitHub's 304 cache (free), so the rate-limit cost is roughly ~1 read
  // per actual new event.
  const pollWatermarkRef = useRef(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInteractivePoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startInteractivePoll = useCallback(
    (sessionId: string, uiSessionId?: string | null) => {
      stopInteractivePoll();
      pollWatermarkRef.current = 0;
      const writeMessages = (
        updater: Message[] | ((prev: Message[]) => Message[]),
      ) => {
        if (uiSessionId) setMessagesForSession(uiSessionId, updater);
        else setMessages(updater);
      };

      const handleLines = (lines: string[]) => {
        for (const line of lines) {
          let event: {
            event?: string;
            payload?: Record<string, unknown>;
          } | null = null;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (!event || !event.event) continue;
          const payload = event.payload ?? {};
          switch (event.event) {
            case "chat.ready": {
              const runUrl =
                typeof payload.runUrl === "string" ? payload.runUrl : undefined;
              dispatchLive({ type: "RUNNER_READY", runUrl });
              break;
            }
            case "chat.exit": {
              dispatchLive({ type: "RUNNER_EXIT" });
              setLoading(false);
              stopInteractivePoll();
              break;
            }
            case "chat.message": {
              // Hazard D fix: an assistant message always returns the
              // session to ready, so the typing indicator can never outlive
              // the reply even if chat.done is dropped.
              dispatchLive({ type: "MESSAGE_RECEIVED" });
              setLoading(false);
              const role =
                payload.role === "user" || payload.role === "assistant"
                  ? payload.role
                  : "assistant";
              const content =
                typeof payload.content === "string" ? payload.content : "";
              const timestamp =
                typeof payload.timestamp === "string"
                  ? payload.timestamp
                  : new Date().toISOString();
              writeMessages((prev) => {
                // Inherit mid-turn progress from the in-flight bubble: any
                // <think> blocks already accumulated from chat.thinking, and
                // all tool-call cards from chat.tool. Without this, when all
                // events arrive together (engine commits at end of turn),
                // chat.message would replace the in-flight with a clean
                // final, erasing the reasoning + tool history.
                const inflight = prev.find(
                  (m) => m.role === "assistant" && m.isLoading,
                );
                const carriedReasoning = inflight?.content ?? "";
                const carriedToolCalls = inflight?.toolCalls;
                return [
                  ...prev.filter(
                    (m) => !(m.role === "assistant" && m.isLoading),
                  ),
                  {
                    role,
                    content: carriedReasoning + content,
                    timestamp,
                    isLoading: false,
                    ...(carriedToolCalls && carriedToolCalls.length > 0
                      ? { toolCalls: carriedToolCalls }
                      : {}),
                  },
                ];
              });
              break;
            }
            case "chat.done":
              dispatchLive({ type: "TURN_DONE" });
              setLoading(false);
              break;
            case "chat.error": {
              const error =
                typeof payload.error === "string"
                  ? payload.error
                  : "Unknown error";
              dispatchLive({ type: "RUNNER_ERROR", errorMessage: error });
              setLoading(false);
              writeMessages((prev) => {
                const filtered = prev.filter(
                  (m) => !(m.role === "assistant" && m.isLoading),
                );
                return [
                  ...filtered,
                  {
                    role: "assistant",
                    content: `Error: ${error}`,
                    isLoading: false,
                    isError: true,
                  },
                ];
              });
              break;
            }
            // Mid-turn progress from Kody Live (engine ≥ 0.4.69). The
            // polling path is the ACTIVE one in production (the SSE path
            // has the same handlers but isn't currently exercised by
            // KodyChat) — both must stay in sync.
            case "chat.thinking": {
              const chunk =
                typeof payload.text === "string" ? payload.text : "";
              if (!chunk) break;
              const block = `<think>${chunk}</think>`;
              writeMessages((prev) => {
                const copy = [...prev];
                const idx = copy.findIndex(
                  (m) => m.role === "assistant" && m.isLoading,
                );
                if (idx < 0) {
                  copy.push({
                    role: "assistant",
                    content: block,
                    timestamp: new Date().toISOString(),
                    isLoading: true,
                  });
                } else {
                  copy[idx] = {
                    ...copy[idx],
                    content: copy[idx].content + block,
                  };
                }
                return copy;
              });
              break;
            }
            case "chat.tool": {
              const phase = payload.phase;
              if (phase === "result") {
                const toolUseId =
                  typeof payload.toolUseId === "string"
                    ? payload.toolUseId
                    : undefined;
                const isError = payload.isError === true;
                writeMessages((prev) => {
                  const copy = [...prev];
                  const idx = copy.findIndex(
                    (m) => m.role === "assistant" && m.isLoading,
                  );
                  if (idx < 0) return copy;
                  const existing = copy[idx].toolCalls ?? [];
                  let target = -1;
                  if (toolUseId)
                    target = existing.findIndex((tc) => tc.id === toolUseId);
                  if (target < 0) {
                    for (let i = existing.length - 1; i >= 0; i--) {
                      if (existing[i].status === "running") {
                        target = i;
                        break;
                      }
                    }
                  }
                  if (target < 0) return copy;
                  const next = existing.slice();
                  next[target] = {
                    ...next[target],
                    status: isError ? "error" : "success",
                  };
                  copy[idx] = { ...copy[idx], toolCalls: next };
                  return copy;
                });
              } else {
                // phase === "use" (or absent — older payloads default to use)
                const toolName =
                  typeof payload.name === "string" ? payload.name : "tool";
                const toolInput = (payload.input ?? {}) as Record<
                  string,
                  unknown
                >;
                const toolId =
                  typeof payload.id === "string" ? payload.id : undefined;
                writeMessages((prev) => {
                  const copy = [...prev];
                  let idx = copy.findIndex(
                    (m) => m.role === "assistant" && m.isLoading,
                  );
                  if (idx < 0) {
                    copy.push({
                      role: "assistant",
                      content: "",
                      timestamp: new Date().toISOString(),
                      isLoading: true,
                      toolCalls: [],
                    });
                    idx = copy.length - 1;
                  }
                  const existing = copy[idx].toolCalls ?? [];
                  copy[idx] = {
                    ...copy[idx],
                    toolCalls: [
                      ...existing,
                      {
                        id: toolId,
                        name: toolName,
                        arguments: toolInput,
                        status: "running",
                      },
                    ],
                  };
                  return copy;
                });
              }
              break;
            }
          }
        }
      };

      const tick = async () => {
        const auth = liveAuthFor(sessionId);
        const params = new URLSearchParams({
          taskId: sessionId,
          since: String(pollWatermarkRef.current),
        });
        if (auth) {
          params.set("owner", auth.owner);
          params.set("repo", auth.repo);
          params.set("token", auth.token);
        }
        try {
          const res = await fetch(
            `/api/kody/events/poll?${params.toString()}`,
            {
              headers: { ...liveAuthHeaders(sessionId) },
            },
          );
          if (!res.ok) return;
          const body = (await res.json()) as {
            lines?: string[];
            totalLines?: number;
          };
          if (Array.isArray(body.lines) && body.lines.length > 0) {
            handleLines(body.lines);
            pollWatermarkRef.current =
              body.totalLines ?? pollWatermarkRef.current + body.lines.length;
          }
        } catch {
          // transient — next tick will retry
        }
      };

      // Fire once immediately so chat.ready already on git lands without
      // a 3s wait. Subsequent ticks every 3s — most are free 304s thanks
      // to ETag caching on the server side.
      void tick();
      pollIntervalRef.current = setInterval(tick, 3_000);
    },
    [dispatchLive, setMessages, setMessagesForSession, stopInteractivePoll],
  );

  // ─── SSE for chat streaming ────────────────────────────────────────────────

  const connectSSE = useCallback(
    (
      sessionId: string,
      opts: { interactive?: boolean; uiSessionId?: string | null } = {},
    ) => {
      // Close any existing connection
      eventSourceRef.current?.close();
      const writeMessages = (
        updater: Message[] | ((prev: Message[]) => Message[]),
      ) => {
        if (opts.uiSessionId) setMessagesForSession(opts.uiSessionId, updater);
        else setMessages(updater);
      };

      // EventSource cannot attach custom headers — we pass the same auth
      // triplet as query params so the stream route can resolve the target
      // repo + GitHub token the same way the other chat endpoints do.
      // For live runners (Kody Live), use the pinned engine repo from the
      // persisted live session — the user may have switched their connected
      // repo after dispatch, but events still live in the dispatch repo.
      const auth = liveAuthFor(sessionId);
      const params = new URLSearchParams({ taskId: sessionId });
      // mode=interactive keeps the SSE alive across multiple chat.done
      // events (one per turn). Closes only on chat.exit.
      if (opts.interactive) params.set("mode", "interactive");
      if (auth) {
        params.set("owner", auth.owner);
        params.set("repo", auth.repo);
        params.set("token", auth.token);
      }
      const url = `/api/kody/events/stream?${params.toString()}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        if (!event.data) return;
        try {
          const parsed = JSON.parse(event.data);
          switch (parsed.type) {
            case "connected":
              break;
            case "chat.ready": {
              const runUrl =
                typeof parsed.runUrl === "string" ? parsed.runUrl : undefined;
              dispatchLive({ type: "RUNNER_READY", runUrl });
              break;
            }
            case "chat.exit": {
              dispatchLive({ type: "RUNNER_EXIT" });
              setLoading(false);
              es.close();
              break;
            }
            case "chat.message": {
              // Hazard D fix (SSE path): mirror the polling path so chat.message
              // alone is enough to clear awaiting + the typing indicator.
              dispatchLive({ type: "MESSAGE_RECEIVED" });
              setLoading(false);
              const { role, content, timestamp } = parsed;
              // Inherit mid-turn progress (reasoning + tool calls) from the
              // in-flight bubble before replacing it with the final reply —
              // see the matching comment in the polling path's handler.
              writeMessages((prev) => {
                const inflight = prev.find(
                  (m) => m.role === "assistant" && m.isLoading,
                );
                const carriedReasoning = inflight?.content ?? "";
                const carriedToolCalls = inflight?.toolCalls;
                return [
                  ...prev.filter(
                    (m) => !(m.role === "assistant" && m.isLoading),
                  ),
                  {
                    role: role === "user" ? "user" : "assistant",
                    content: carriedReasoning + (content ?? ""),
                    timestamp: timestamp ?? new Date().toISOString(),
                    isLoading: false,
                    ...(carriedToolCalls && carriedToolCalls.length > 0
                      ? { toolCalls: carriedToolCalls }
                      : {}),
                  },
                ];
              });
              break;
            }
            case "chat.done":
              dispatchLive({ type: "TURN_DONE" });
              setLoading(false);
              // In interactive mode, chat.done is per-turn — keep SSE open;
              // the runner stays alive until chat.exit.
              if (!opts.interactive) es.close();
              break;
            case "chat.error": {
              dispatchLive({
                type: "RUNNER_ERROR",
                errorMessage:
                  typeof parsed.error === "string"
                    ? parsed.error
                    : "Unknown error",
              });
              setLoading(false);
              writeMessages((prev) => {
                const filtered = prev.filter(
                  (m) => !(m.role === "assistant" && m.isLoading),
                );
                return [
                  ...filtered,
                  {
                    role: "assistant",
                    content: `Error: ${parsed.error ?? "Unknown error"}`,
                    isLoading: false,
                    isError: true,
                  },
                ];
              });
              if (!opts.interactive) es.close();
              break;
            }
            // Mid-turn progress from Kody Live (engine ≥ 0.4.69). The engine
            // emits these as the agent works so the user sees thinking +
            // tool calls live instead of a blank chat for 60-120s.
            case "chat.thinking": {
              // Inline the reasoning chunk into content as a <think>
              // block. The existing parseReasoning() in the renderer
              // already splits content into a ReasoningPanel + answer,
              // so one path handles both the kody-direct (<think>) and
              // Kody Live backends — no parallel `reasoning` field
              // needed, no renderer change required.
              const chunk = typeof parsed.text === "string" ? parsed.text : "";
              if (!chunk) break;
              const block = `<think>${chunk}</think>`;
              writeMessages((prev) => {
                const copy = [...prev];
                const idx = copy.findIndex(
                  (m) => m.role === "assistant" && m.isLoading,
                );
                if (idx < 0) {
                  copy.push({
                    role: "assistant",
                    content: block,
                    timestamp: parsed.timestamp ?? new Date().toISOString(),
                    isLoading: true,
                  });
                } else {
                  copy[idx] = {
                    ...copy[idx],
                    content: copy[idx].content + block,
                  };
                }
                return copy;
              });
              break;
            }
            case "chat.tool_use": {
              const toolName =
                typeof parsed.name === "string" ? parsed.name : "tool";
              const toolInput = (parsed.input ?? {}) as Record<string, unknown>;
              const toolId =
                typeof parsed.id === "string" ? parsed.id : undefined;
              writeMessages((prev) => {
                const copy = [...prev];
                let idx = copy.findIndex(
                  (m) => m.role === "assistant" && m.isLoading,
                );
                if (idx < 0) {
                  copy.push({
                    role: "assistant",
                    content: "",
                    timestamp: parsed.timestamp ?? new Date().toISOString(),
                    isLoading: true,
                    toolCalls: [],
                  });
                  idx = copy.length - 1;
                }
                const existing = copy[idx].toolCalls ?? [];
                copy[idx] = {
                  ...copy[idx],
                  toolCalls: [
                    ...existing,
                    {
                      id: toolId,
                      name: toolName,
                      arguments: toolInput,
                      status: "running",
                    },
                  ],
                };
                return copy;
              });
              break;
            }
            case "chat.tool_result": {
              const toolUseId =
                typeof parsed.toolUseId === "string"
                  ? parsed.toolUseId
                  : undefined;
              const isError = parsed.isError === true;
              writeMessages((prev) => {
                const copy = [...prev];
                const idx = copy.findIndex(
                  (m) => m.role === "assistant" && m.isLoading,
                );
                if (idx < 0) return copy;
                const existing = copy[idx].toolCalls ?? [];
                // Match by tool_use id when the engine provided one;
                // otherwise mark the most recent pending call as done.
                let target = -1;
                if (toolUseId) {
                  target = existing.findIndex((tc) => tc.id === toolUseId);
                }
                if (target < 0) {
                  for (let i = existing.length - 1; i >= 0; i--) {
                    if (existing[i].status === "running") {
                      target = i;
                      break;
                    }
                  }
                }
                if (target < 0) return copy;
                const next = existing.slice();
                next[target] = {
                  ...next[target],
                  status: isError ? "error" : "success",
                };
                copy[idx] = { ...copy[idx], toolCalls: next };
                return copy;
              });
              break;
            }
          }
        } catch {
          // skip malformed
        }
      };

      es.onerror = () => {
        // Don't close: EventSource auto-reconnects on transient errors
        // (network blip, Vercel idle TCP timeout). Closing here permanently
        // breaks long-lived interactive sessions.
        setLoading(false);
      };

      // Vercel's Node runtime buffers SSE responses for long-lived
      // connections — events sit in the buffer until the connection
      // closes. A fresh connection drains the buffer immediately and
      // reads the events from GitHub, so we sidestep the bug by cycling
      // the connection every 25s when in interactive mode. Each cycle
      // re-pulls all events from the events file (the server clears its
      // per-session lastReadIndex on every new connection, so it replays
      // from line 0; client-side seenEventIds deduplicates).
      if (opts.interactive) {
        const cycleTimer = setTimeout(() => {
          if (eventSourceRef.current === es) connectSSE(sessionId, opts);
        }, 25_000);
        // Cancel the cycle if a NEW connectSSE supersedes us before 25s.
        const orig = es.close.bind(es);
        es.close = () => {
          clearTimeout(cycleTimer);
          orig();
        };
      }
    },
    [dispatchLive, setMessages, setMessagesForSession],
  );

  // Open SSE whenever we have a scoped session id — task id for task mode,
  // `capability-{slug}` for capability mode.
  // Global-mode streams are opened on demand inside the send path.
  //
  // Tab-visibility gate: the server-side SSE handler polls GitHub every 3s as
  // a fallback for cross-instance push. With hundreds of background tabs that
  // drains the shared GH rate-limit token. Closing the EventSource on
  // `visibilityState=hidden` halts the server poll (req.signal.abort fires);
  // we reopen on `visible`. Loss of in-flight push events is acceptable —
  // chat history is hydrated from useChatSessions (the global session store)
  // on next view, with state repo chat/global.json as a cross-device fallback.
  useEffect(() => {
    const sid =
      selectedTask?.id ??
      (capabilitySlug != null ? `capability-${capabilitySlug}` : null) ??
      null;
    if (!sid) {
      return () => {
        eventSourceRef.current?.close();
      };
    }

    const open = () => {
      if (
        eventSourceRef.current &&
        eventSourceRef.current.readyState !== EventSource.CLOSED
      )
        return;
      connectSSE(sid, { uiSessionId: activeSessionIdForReset });
    };
    const close = () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") open();
      else close();
    };

    if (document.visibilityState === "visible") open();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      close();
    };
  }, [selectedTask?.id, capabilitySlug, connectSSE, activeSessionIdForReset]);

  // Unified thread: the global session store (useChatSessions) owns the
  // message list. Per-page scope (task / capability / planner / report) flows
  // through the per-turn system-prompt blocks, not separate stores. The
  // "New conversation" button is the only way to reset the thread.

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

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

  const sendText = useCallback(
    async (
      messageContent: string,
      currentAttachments: Attachment[] = [],
      options: {
        voiceMode?: boolean;
        hidden?: boolean;
        forceAgentId?: AgentId;
        onVoiceDelta?: (spokenSoFar: string) => void;
        onAssistantTextComplete?: (
          assistantText: string,
        ) => string | null | void;
        /**
         * Override the text that goes into the user bubble. Defaults to
         * `messageContent` — set this when the model should see something
         * different from what the user sees (e.g. an expanded slash-command
         * prompt: the model gets the expanded body, the bubble shows only
         * what the user typed).
         */
        displayContent?: string;
      } = {},
    ): Promise<string | null> => {
      if (!messageContent.trim() && currentAttachments.length === 0)
        return null;

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

          setLoading(false);
          setMessages((prev) =>
            prev.map((m) => (m.isLoading ? { ...m, isLoading: false } : m)),
          );
          // Voice mode: defense-in-depth strip of `<think>` blocks before
          // handing the reply to TTS. The brain server is expected to drop
          // them when voiceMode is set, but the dashboard should never
          // narrate them even if an old server leaks them through.
          const spokenText = voiceMode
            ? stripReasoning(brainTurn.state.latestAssistantText)
            : brainTurn.state.latestAssistantText;
          return spokenText || null;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            setMessages((prev) => prev.slice(0, -1));
            return null;
          }
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          setLoading(false);
          setMessages((prev) => {
            const filtered = prev.filter(
              (m) => !(m.role === "assistant" && m.isLoading),
            );
            return [
              ...filtered,
              {
                role: "assistant",
                content: `Error: ${errorMessage}`,
                isLoading: false,
                isError: true,
              },
            ];
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
            lastToolErrorText,
            lastToolErrorToolName,
            pendingSwitchAgent,
            pendingDashboardNavigate,
            pendingPreviewAct,
            pendingView,
            pendingCreatedIssue,
          } = kodyTurn.state;

          const assistantText = textBuf.trim();
          let assistantDisplayOverride: string | null | void;
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

          // Terminal — mark not loading. If the turn produced NOTHING visible
          // (no answer text, no reasoning, no tool calls) and isn't handing off
          // to a runner, surface a note instead of leaving a silent blank
          // bubble — the user must always get feedback.
          setMessages((prev) => {
            const copy = [...prev];
            const idx = copy.findIndex(
              (m) => m.role === "assistant" && m.isLoading,
            );
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
          setLoading(false);
          // Apply any UI-control directives the model emitted. Done after
          // the assistant bubble settles so the agent flip doesn't race
          // the in-flight render or interrupt voice TTS that is still
          // speaking the confirmation sentence.
          if (
            pendingSwitchAgent &&
            isSwitchAgentDirective(pendingSwitchAgent)
          ) {
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
          // not a real failure; just settle the bubble and bail. Without
          // this guard the user sees an "Error: signal is aborted..."
          // bubble after every stop.
          const isAbort =
            (err instanceof DOMException && err.name === "AbortError") ||
            (err instanceof Error && err.name === "AbortError");
          if (isAbort) {
            setLoading(false);
            setMessages((prev) => {
              const copy = [...prev];
              const idx = copy.findIndex(
                (m) => m.role === "assistant" && m.isLoading,
              );
              if (idx >= 0) {
                copy[idx] = { ...copy[idx], isLoading: false };
              }
              return copy;
            });
            return null;
          }
          const errorMessage =
            err instanceof Error ? err.message : "Unknown error";
          setLoading(false);
          setMessages((prev) => {
            const filtered = prev.filter(
              (m) => !(m.role === "assistant" && m.isLoading),
            );
            return [
              ...filtered,
              {
                role: "assistant",
                content: `Error: ${errorMessage}`,
                isLoading: false,
                isError: true,
              },
            ];
          });
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
        if (
          !liveSessionId ||
          (liveState !== "ready" && liveState !== "booting")
        ) {
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
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          setLoading(false);
          setMessages((prev) => {
            const filtered = prev.filter(
              (m) => !(m.role === "assistant" && m.isLoading),
            );
            return [
              ...filtered,
              {
                role: "assistant",
                content: `Error: ${errorMessage}`,
                isLoading: false,
                isError: true,
              },
            ];
          });
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
        if (error instanceof Error && error.name === "AbortError") {
          setMessages((prev) => prev.slice(0, -1));
          return null;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setLoading(false);
        setMessages((prev) => {
          const filtered = prev.filter(
            (m) => !(m.role === "assistant" && m.isLoading),
          );
          return [
            ...filtered,
            {
              role: "assistant",
              content: `Error: ${errorMessage}`,
              isLoading: false,
              isError: true,
            },
          ];
        });
        return null;
      }
    },
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

  // Kody Live: warm-up the long-lived runner. Wires the dispatch + SSE
  // for an interactive session. Chat input stays disabled until the runner
  // emits chat.ready (handled in connectSSE).
  const startInteractiveSession = useCallback(
    async (opts?: {
      initialContent?: string;
      initialTimestamp?: string;
      taskContext?: import("../chat/plugins/vibe").VibeLiveTaskContext;
      uiSessionId?: string | null;
    }) => {
      const cur = liveStateRef.current.phase;
      if (cur === "booting" || cur === "ready" || cur === "awaiting") return;

      // Embed the scope key in the sessionId so kody.yml's concurrency
      // group (`kody-${sessionId}`) puts each issue in its own bucket.
      // Two vibe issues now boot independent runners.
      const scopeKey = currentScopeKeyRef.current;
      const sessionId = `${scopeKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();
      dispatchLive({ type: "START", sessionId, scopeKey, startedAt });

      try {
        // dashboardUrl re-enabled — engine pushes events to /ingest in
        // real time so chat replies don't wait for the 3s file-poll. Auth
        // on /ingest is GitHub Actions IP verification (no shared secret).
        const dashboardUrl =
          typeof window !== "undefined"
            ? `${window.location.origin}/api/kody/events/ingest`
            : undefined;
        // Route to Fly Machines spawner when the user picked the kody-live-fly
        // agent — same engine + same session JSONL, different runtime.
        const isFlyRoute = selectedAgentId === "kody-live-fly";
        const startEndpoint = isFlyRoute
          ? "/api/kody/chat/interactive/start-fly"
          : "/api/kody/chat/interactive/start";
        // Fly token now lives in the repo vault (project-scoped) and is read
        // by the start-fly route directly — no header needed. Perf tier
        // stays per-user in localStorage and is sent as a header.
        const flyHeader: Record<string, string> = {};
        if (isFlyRoute) {
          const flyPerf = getStoredFlyPerf();
          if (flyPerf) flyHeader["x-kody-fly-perf"] = flyPerf;
        }
        const startRes = await fetch(startEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
            ...flyHeader,
          },
          body: JSON.stringify({
            taskId: sessionId,
            dashboardUrl,
            idleExitMs: 5 * 60_000,
            hardCapMs: 30 * 60_000,
            // Forward the chat-level thinking pick so the engine's
            // extended-thinking budget matches the chat's reasoning
            // dropdown. Empty when the user is on Live (no chat-level
            // pick) — engine falls back to its own default.
            ...(effectiveReasoningEffort
              ? { reasoningEffort: effectiveReasoningEffort }
              : {}),
            // First turn folded into the session-create commit (atomic) so the
            // runner sees it on first read — no racy follow-up append.
            ...(opts?.initialContent
              ? {
                  content: opts.initialContent,
                  timestamp: opts.initialTimestamp,
                  ...vibeTurnFields(vibeMode, opts.taskContext),
                }
              : {}),
          }),
        });
        if (!startRes.ok) {
          const body = (await startRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${startRes.status}`);
        }
        const startBody = (await startRes.json().catch(() => ({}))) as {
          target?: { owner: string; repo: string };
        };
        if (startBody.target) {
          // Reducer's persistence useEffect will re-save the record with the
          // resolved target so a refresh during boot still shows the link.
          dispatchLive({ type: "TARGET_RESOLVED", target: startBody.target });
        }
        startInteractivePoll(
          sessionId,
          opts?.uiSessionId ?? activeSessionIdForReset,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        dispatchLive({ type: "START_FAILED", errorMessage });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Failed to start live runner: ${errorMessage}`,
            isLoading: false,
          },
        ]);
      }
    },
    [
      setMessages,
      selectedAgentId,
      startInteractivePoll,
      dispatchLive,
      vibeMode,
      activeSessionIdForReset,
    ],
  );

  // Cancel a Kody Live session locally. Closes the SSE, clears the saved
  // record for the CURRENT scope, and flips state to 'idle' so the user
  // can start a fresh one. Does NOT cancel the GitHub Actions run — the
  // runner idle-exits on its own (default 5min) so leaving it alone is cheap.
  const endInteractiveSession = useCallback(() => {
    stopInteractivePoll();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    dispatchLive({ type: "END" });
  }, [stopInteractivePoll, dispatchLive]);

  // Force a clean restart of the live session — used by the "Runner stuck —
  // restart?" affordance. Tears down poll + SSE, resets the reducer, then
  // kicks off a fresh /start.
  const restartInteractiveSession = useCallback(async () => {
    stopInteractivePoll();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    dispatchLive({ type: "FORCE_RESET" });
    // Defer to next tick so the reducer's persistence effect can clear the
    // stale localStorage record before /start writes a new one.
    await Promise.resolve();
    await startInteractiveSession();
  }, [stopInteractivePoll, dispatchLive, startInteractiveSession]);

  // ── Scope tracking ───────────────────────────────────────────────────
  // Each chat scope (Vibe issue vs global) has its own live session. When
  // the user switches issues, swap the in-view session: close the old
  // SSE, then either rehydrate the new scope's saved record or reset to
  // idle. Runners for off-screen scopes keep running in GHA and will
  // self-exit on idle.
  const rehydrateForScope = useCallback(
    (scopeKey: LiveScopeKey) => {
      const saved = loadLiveSession(scopeKey);
      // Close any prior SSE before swapping refs so old events don't
      // race the new state.
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      stopInteractivePoll();
      // Record ↔ action mapping (REHYDRATE_IDLE vs REHYDRATE_RESTORED,
      // incl. bootStartedAt only while booting) is pure logic in
      // chat/core/rehydration.ts.
      if (!saved) {
        dispatchLive(buildRehydrateAction(scopeKey, null));
        return;
      }
      dispatchLive(buildRehydrateAction(scopeKey, saved));
      setSelectedAgentId("kody-live");
      // Mirror the rehydrated runner agent onto the active session so
      // a refresh / re-open lands back on Kody Live. The Fly variant
      // is also valid here — the entry list is the source of truth
      // for which one is available.
      const rehydrateEntry = agentList.find(
        (e) => e.key === "kody-live-fly" || e.key === "kody-live",
      );
      const rehydrateId = sessionHook.activeSession?.id;
      if (rehydrateId && rehydrateEntry) {
        sessionHook.setSessionAgent(rehydrateId, rehydrateEntry.key);
      }
      startInteractivePoll(saved.sessionId);
    },
    [startInteractivePoll, stopInteractivePoll, dispatchLive],
  );

  useEffect(() => {
    const nextScope = getLiveScopeKey(context, vibeMode);
    // Duplicate-rehydrate suppression lives in chat/core/rehydration.ts:
    // same scope + restore already attempted → no-op.
    if (
      !shouldRehydrateScope(
        nextScope,
        currentScopeKeyRef.current,
        liveRestoreAttemptedRef.current,
      )
    ) {
      return;
    }
    currentScopeKeyRef.current = nextScope;
    liveRestoreAttemptedRef.current = true;
    rehydrateForScope(nextScope);
  }, [context, vibeMode, rehydrateForScope]);

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

  // ── Watchdog ─────────────────────────────────────────────────────────
  // The runner is supposed to drive its own lifecycle (chat.ready → ...
  // → chat.exit). Sometimes it dies silently — GHA cancellation, network
  // partition, OOM — and the dashboard is left believing it's still alive.
  // When that happens the UI shows "Kody Live is thinking…" forever.
  //
  // The watchdog re-anchors the UI to server truth. If we've been in a
  // waiting phase (booting/awaiting) without a new event for too long, we
  // ask /api/kody/chat/session/[id]/status what the events file says, and
  // dispatch STATUS_RESULT. The reducer downgrades to 'stuck' if the
  // server confirms the runner is gone — at which point the banner
  // surfaces a Restart button.
  //
  // Thresholds: booting takes ~90s on GHA cold start, ~45s on Fly; allow
  // 150s before suspecting. A turn can take 2-3 min for complex work;
  // allow 240s after the last event before suspecting.
  const watchdogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (watchdogTimeoutRef.current) {
      clearTimeout(watchdogTimeoutRef.current);
      watchdogTimeoutRef.current = null;
    }
    if (!isWatchdogActive(liveState.phase) || !liveState.sessionId) return;

    const sessionId = liveState.sessionId;
    const since =
      liveState.lastEventAt ?? liveState.bootStartedAt ?? Date.now();
    const deadlineMs = liveState.phase === "booting" ? 150_000 : 240_000;
    const remainingMs = Math.max(5_000, deadlineMs - (Date.now() - since));

    watchdogTimeoutRef.current = setTimeout(() => {
      // Re-read the source of truth — the reducer may have advanced
      // between scheduling and firing (a new event reset lastEventAt).
      const cur = liveStateRef.current;
      if (!cur.sessionId || cur.sessionId !== sessionId) return;
      if (!isWatchdogActive(cur.phase)) return;
      const ageMs =
        Date.now() - (cur.lastEventAt ?? cur.bootStartedAt ?? Date.now());
      const phaseDeadline = cur.phase === "booting" ? 150_000 : 240_000;
      if (ageMs < phaseDeadline) return; // false alarm — reschedule via next render

      const params = new URLSearchParams();
      const auth = liveAuthFor(sessionId);
      if (auth) {
        params.set("owner", auth.owner);
        params.set("repo", auth.repo);
        params.set("token", auth.token);
      }
      // Pass our local lastEventAt so the server can detect the
      // "engine pushed events via real-time HTTP but never committed
      // them to the file" zombie case.
      const localLast = cur.lastEventAt ?? cur.bootStartedAt ?? null;
      if (localLast !== null) {
        params.set("clientLastEventAt", String(localLast));
      }
      fetch(
        `/api/kody/chat/session/${encodeURIComponent(sessionId)}/status${params.size ? `?${params}` : ""}`,
        { headers: { ...liveAuthHeaders(sessionId) } },
      )
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (
            body: {
              runnerAlive?: boolean;
              lastEventAt?: number | null;
              reason?: string | null;
            } | null,
          ) => {
            if (!body) return;
            // The reducer guards against a stale dispatch — only flips to
            // 'stuck' if it's still in an active phase when STATUS_RESULT
            // arrives.
            dispatchLive({
              type: "STATUS_RESULT",
              runnerAlive: Boolean(body.runnerAlive),
              lastEventAt: body.lastEventAt ?? null,
              errorMessage: body.reason ?? undefined,
            });
          },
        )
        .catch(() => {
          // Network failure: don't assume zombie. Leave the user the manual
          // restart affordance — the banner already shows after enough time.
        });
    }, remainingMs);

    return () => {
      if (watchdogTimeoutRef.current) {
        clearTimeout(watchdogTimeoutRef.current);
        watchdogTimeoutRef.current = null;
      }
    };
  }, [
    liveState.phase,
    liveState.sessionId,
    liveState.lastEventAt,
    liveState.bootStartedAt,
    dispatchLive,
  ]);

  const sendInputToTerminal = useCallback(() => {
    const command = input;
    if (!command.trim()) return;
    if (!activeTerminalInstanceId) {
      toast.error("Terminal is not ready yet");
      return;
    }

    const terminal = terminalSurfaceRefs.current[activeTerminalInstanceId];
    if (!terminal) {
      toast.error("Terminal is still opening");
      return;
    }

    if (!terminal.sendLine(command)) {
      toast.error("Terminal is not connected yet");
      terminal.focus();
      return;
    }

    setInput("");
    setSlashMenuOpen(false);
    setSlashSelectedIndex(0);
    requestAnimationFrame(() => {
      const textarea = composerTextareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.focus();
    });
  }, [activeTerminalInstanceId, input]);

  const sendMessage = async () => {
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
  };

  // ─── Voice chat integration ───

  const handleVoiceSend = useCallback(
    async (transcript: string) => {
      // Voice is a modality, not an agent. We keep the user's selected
      // agent and just flip the voiceMode flag — the server appends the
      // voice overlay onto that agent's system prompt.
      //
      // Stream the reply into TTS sentence-by-sentence so it starts
      // speaking ~1 sentence in, instead of waiting for the whole answer.
      // `spokenPtr` tracks how much of the cumulative spoken text we've
      // already queued; each delta yields any newly-completed sentences.
      let spokenPtr = 0;
      const flushSentences = (full: string) => {
        if (full.length < spokenPtr) return; // safety: never go backwards
        const { sentences, consumed } = extractSentences(full.slice(spokenPtr));
        if (consumed > 0) spokenPtr += consumed;
        for (const s of sentences) voiceChatRef.current?.speakChunk(s);
      };
      try {
        const response = await sendText(transcript, [], {
          voiceMode: true,
          onVoiceDelta: flushSentences,
        });
        // Flush the trailing partial (a final sentence without terminal
        // punctuation).
        if (response) {
          const tail = response.slice(spokenPtr).trim();
          if (tail) voiceChatRef.current?.speakChunk(tail);
        }
      } finally {
        // Always mark the reply complete — even on error/throw — so TTS
        // hands back to listening and the mic never strands "off".
        voiceChatRef.current?.endResponse();
      }
    },
    [sendText],
  );

  const voiceChat = useVoiceChat({
    enabled: voiceOverlayOpen,
    onSendMessage: handleVoiceSend,
    voiceId,
  });
  const voiceChatRef = useRef(voiceChat);
  useEffect(() => {
    voiceChatRef.current = voiceChat;
  }, [voiceChat]);

  const handleVoiceToggleMute = useCallback(() => {
    setVoiceMuted((prev) => {
      const next = !prev;
      if (next) voiceChat.pauseConversation();
      else voiceChat.resumeConversation();
      return next;
    });
  }, [voiceChat]);

  // Belt-and-suspenders cleanup: every code path that closes the voice
  // overlay should already call stopConversation, but if any future
  // close path forgets (or a streamed reply lands AFTER the user
  // closes), we still want speech + recognition to shut down. Driving
  // it off voiceOverlayOpen guarantees no orphan TTS keeps narrating
  // once the window is gone.
  useEffect(() => {
    if (voiceOverlayOpen) return;
    voiceChatRef.current?.stopConversation();
  }, [voiceOverlayOpen]);

  // Apply a slash command to the input: replaces the entire input with
  // "/slug " so the user can immediately type arguments, OR sends right
  // away when the prompt takes no arguments and the user pressed Enter.
  const refreshAgentMentionTrigger = useCallback(
    (value: string, caretIndex: number | null | undefined) => {
      if (chatMode !== "ai") {
        setAgentMentionTrigger(null);
        return;
      }
      const trigger = parseStaffMentionTrigger(
        value,
        caretIndex ?? value.length,
      );
      setAgentMentionTrigger(trigger);
      setAgentMentionSelectedIndex(0);
    },
    [chatMode],
  );

  const handleComposerInputChange = useCallback(
    (
      next: string,
      caretIndex: number | null | undefined,
      textarea?: HTMLTextAreaElement | null,
    ) => {
      setInput(next);
      refreshAgentMentionTrigger(next, caretIndex);
      // Slash menu opens on `/` at line start, stays open while
      // the user types the slug, closes when they add a space
      // or clear the slash.
      if (chatMode === "ai") {
        const trigger = parseSlashTrigger(next);
        setSlashMenuOpen(trigger.active && slashCommands.length > 0);
        if (trigger.active) setSlashSelectedIndex(0);
      } else {
        setSlashMenuOpen(false);
      }
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
      }
    },
    [chatMode, refreshAgentMentionTrigger, slashCommands.length],
  );

  const applyAgentMentionSelection = useCallback(
    (slug: string) => {
      if (!agentMentionTrigger) return;
      const next = replaceStaffMentionTrigger(input, agentMentionTrigger, slug);
      const nextCaret = agentMentionTrigger.start + slug.length + 2;
      setInput(next);
      setAgentMentionTrigger(null);
      setAgentMentionSelectedIndex(0);
      requestAnimationFrame(() => {
        const textarea = composerTextareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [agentMentionTrigger, input],
  );

  const applySlashSelection = (slug: string) => {
    const command = slashCommands.find((p) => p.slug === slug);
    if (!prompt) return;
    setSlashMenuOpen(false);
    setSlashSelectedIndex(0);
    // Always insert "/slug " and let the user add args (or hit Enter
    // again to send). Sending immediately on first select would break
    // the case where the prompt needs arguments.
    setInput(`/${slug} `);
  };

  // Close the slash menu + mention popover. The Composer calls this from
  // its onBlur after a small delay so the menus' onMouseDown can fire
  // before close (see the comment at the blur handler).
  const closeComposerMenus = useCallback(() => {
    setSlashMenuOpen(false);
    setAgentMentionTrigger(null);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      chatMode === "ai" &&
      agentMentionTrigger &&
      filteredAgentMentions.length > 0
    ) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAgentMentionSelectedIndex((i) =>
          Math.min(i + 1, filteredAgentMentions.length - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAgentMentionSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked =
          filteredAgentMentions[
            Math.min(
              agentMentionSelectedIndex,
              filteredAgentMentions.length - 1,
            )
          ];
        if (picked) applyAgentMentionSelection(picked.slug);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAgentMentionTrigger(null);
        return;
      }
    }

    // Slash menu keyboard navigation. Only intercept when the menu is
    // open AND the input still looks like a slug-in-progress (so once
    // the user types a space the menu's gone and normal handling resumes).
    if (chatMode === "ai" && slashMenuOpen) {
      const { filter } = parseSlashTrigger(input);
      const matches = filterCommands(slashCommands, filter);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((i) =>
          Math.min(i + 1, Math.max(matches.length - 1, 0)),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        if (matches.length > 0) {
          e.preventDefault();
          const picked =
            matches[Math.min(slashSelectedIndex, matches.length - 1)];
          if (picked) applySlashSelection(picked.slug);
          return;
        }
      }
    }
    // Desktop AI chat and terminal keep Enter-to-send. Mobile AI chat leaves
    // plain Enter to the textarea so the soft keyboard inserts a newline.
    if (
      (chatMode === "terminal" || isDesktop) &&
      e.key === "Enter" &&
      !e.shiftKey
    ) {
      e.preventDefault();
      sendMessage();
      return;
    }
    // Esc aborts a streaming reply.
    if (e.key === "Escape" && activeLoading) {
      e.preventDefault();
      handleStop();
      return;
    }
    // ↑ on an empty composer recalls the last user message for editing —
    // matches the shell history convention.
    if (
      chatMode === "ai" &&
      e.key === "ArrowUp" &&
      !input &&
      attachments.length === 0
    ) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        e.preventDefault();
        setInput(lastUser.content);
      }
    }
  };

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
          headers: { "Content-Type": "application/json", ...authHeaders() },
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
  }, [isGlobalMode, activeLoading, messages, sessionHook, selectedModelId]);

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
  const richComposerEnabled = chatMode === "ai" && Boolean(railFullscreen);
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

  // Terminal chrome — plugin components passed as HOST ReactNodes (not
  // registry slots) so the DOM stays byte-identical (see
  // chat/plugins/terminal/TerminalControls.tsx). Visibility rules are host
  // state: no toggle when the surface hides terminal mode, pins an agent,
  // or runs vibe.
  const chatModeToggle =
    !hideTerminalMode && !lockedAgentId && !vibeMode ? (
      <TerminalModeToggle
        chatMode={chatMode}
        terminalStatusLabel={terminalStatusLabel}
        hasLiveTerminal={activeSessionHasLiveTerminal}
        connectionState={activeTerminalConnectionState}
        onSelectAiMode={() => setActiveChatMode("ai")}
        onOpenTerminal={openTerminalMode}
      />
    ) : null;

  const terminalTopControls =
    chatMode === "terminal" ? (
      <TerminalTopControls
        activeTargetValue={activeTerminalValue}
        onSelectTarget={handleTerminalTargetSelect}
        activeTransport={activeTerminalTransport}
        terminalMachines={terminalMachines}
        flyInventoryError={flyInventoryError}
        flyInventoryLoading={flyInventoryLoading}
        onRefreshMachines={() => void refreshChatTerminalFlyMachines()}
        brainImageBusy={brainImageSave.busy}
        brainImageSaveLabel={brainImageSave.label}
        onSaveBrainImage={() => void brainImageSave.save()}
      />
    ) : null;
  const activeTerminalSurface = activeTerminalInstanceId
    ? terminalSurfaceRefs.current[activeTerminalInstanceId]
    : null;
  const terminalInputTone = activeTerminalChrome?.inputTone ?? "idle";
  const terminalSendBusy =
    chatMode === "terminal" &&
    (terminalInputTone === "queued" || activeTerminalChrome?.actionBusy);
  const terminalSendDisabled =
    chatMode === "terminal" &&
    (terminalInputTone === "blocked" || terminalSendBusy);
  const terminalProblemMessage =
    chatMode === "terminal" &&
    terminalInputTone === "blocked" &&
    /stalled|error|failed|websocket|reconnecting/i.test(
      activeTerminalChrome?.statusText ?? "",
    )
      ? activeTerminalChrome?.statusText
      : null;
  const terminalBottomControls =
    chatMode === "terminal" ? (
      <TerminalBottomControls
        onAddToChat={() => activeTerminalSurface?.addToChat()}
        onRestart={() => activeTerminalSurface?.restart()}
        onClear={() => activeTerminalSurface?.clear()}
        actionBusy={activeTerminalChrome?.actionBusy}
      />
    ) : null;

  return (
    // Plugin platform mount (Step 4): the provider exposes THIS mount's
    // registry to the surface pieces (HeaderControls / Composer slots and
    // the footer slot below). With no plugins the provider is inert and
    // every slot renders nothing — zero DOM diff.
    <ChatPluginProvider registry={pluginRegistry} host={pluginHost}>
      <div
        data-testid="kody-chat-root"
        className={`relative flex h-full overflow-hidden bg-background ${
          standalonePresentation ? "" : "md:border-l"
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay — visible while a file is being dragged over the chat */}
        {isDraggingFile && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-md backdrop-blur-sm">
            <div className="px-4 py-3 bg-background/90 rounded-lg shadow-lg text-base font-medium text-primary">
              Drop to attach
            </div>
          </div>
        )}
        {/* Session Sidebar */}
        <SessionsPanel
          open={showSessionSidebar}
          isGlobalMode={isGlobalMode}
          pinned={sessionSidebarPinned}
          railFullscreen={railFullscreen}
          standalonePresentation={standalonePresentation}
          sessions={sessionHook.sessions}
          activeSessionId={sessionHook.activeSession?.id || null}
          modeBySessionId={
            vibeMode ? undefined : terminalRegistry.modeBySessionId
          }
          onSwitchSession={(id) => {
            sessionHook.switchSession(id);
          }}
          onCreateSession={() => {
            sessionHook.createSession();
          }}
          onDeleteSession={sessionHook.deleteSession}
          onRenameSession={sessionHook.renameSession}
          onPinSession={sessionHook.pinSession}
          onTogglePinned={() => setSessionSidebarPinned((prev) => !prev)}
          onClose={() => setShowSessionSidebar(false)}
        />

        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Voice Chat Overlay */}
          {voiceOverlayOpen && (
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
          )}
          {/* Header with context — extracted to chat/surface/HeaderControls.
          Menu open/close state, selection state, and the per-session agent
          pick stay here; the region is presentation-only. */}
          <HeaderControls
            currentEntry={currentEntry}
            currentAgent={currentAgent}
            lockedAgentId={lockedAgentId}
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

          {/* Kody waiting for instructions banner */}
          {isKodyWaiting && actionState && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-sm text-amber-800">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
              </span>
              <span className="font-medium">
                Kody is waiting for your instructions
              </span>
              {actionState.step && (
                <span className="text-amber-600">
                  — paused at{" "}
                  <code className="bg-amber-100 px-1 rounded">
                    {actionState.step}
                  </code>
                </span>
              )}
            </div>
          )}

          {/* Messages area */}
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
            emptyState={
              <div className="text-center text-muted-foreground text-base py-8">
                {isTaskMode ? (
                  <>
                    <p className="font-medium">Chat about this task</p>
                    <p className="text-sm mt-1">
                      {vibeMode
                        ? VIBE_TASK_EMPTY_STATE_HINT
                        : "Messages will be saved to the task"}
                    </p>
                    <p className="text-sm mt-3 font-medium text-foreground">
                      I can help you:
                    </p>
                    <ul className="mt-2 text-left text-sm space-y-2 max-w-sm mx-auto">
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>
                          Diagnose the linked PR if it didn&apos;t fully fix the
                          issue — try{" "}
                          <span className="font-mono">
                            &quot;diagnose{" "}
                            {selectedTask?.associatedPR
                              ? `PR #${selectedTask.associatedPR.number}`
                              : "this PR"}
                            &quot;
                          </span>
                          . I&apos;ll read the diff, find the gap, and draft a
                          sharper <span className="font-mono">@kody fix</span>{" "}
                          for your approval.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>
                          Explain the issue, the PR diff, or pipeline status
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>
                          Browse and search the repository for related code
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>
                          Draft a follow-up{" "}
                          <span className="font-mono">@kody</span> instruction
                        </span>
                      </li>
                    </ul>
                  </>
                ) : isCapabilityMode && selectedCapability ? (
                  <>
                    <p className="font-medium text-foreground">
                      Chat about `{selectedCapability.slug}`
                    </p>
                    <p className="text-sm mt-1 max-w-sm mx-auto">
                      Ask anything about this capability&apos;s intent, scope,
                      or rules. Each capability has its own thread.
                    </p>
                  </>
                ) : isPlannerMode && plannerGoal ? (
                  <>
                    <p className="font-medium text-foreground">
                      Plan tasks for &ldquo;{plannerGoal.name}&rdquo;
                    </p>
                    <p className="text-sm mt-1 max-w-md mx-auto">
                      Say <span className="font-mono">&quot;plan it&quot;</span>{" "}
                      (or paste extra context first). I&apos;ll propose a task
                      list, you approve, then I&apos;ll deepen each spec and
                      create the issues attached to this goal.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Hi! I can help you with:</p>
                    <ul className="mt-3 text-left text-sm space-y-2">
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>Browse repository files and code</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>Search code across the codebase</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>List and explain tasks</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>Show pipeline status and progress</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>
                          Diagnose a Kody PR that didn&apos;t fully solve its
                          issue — try{" "}
                          <span className="font-mono">
                            &quot;diagnose PR #1404&quot;
                          </span>
                        </span>
                      </li>
                    </ul>
                  </>
                )}
              </div>
            }
            terminalSurfaces={mountedChatTerminals.map((terminal) => {
              const isActiveTerminal =
                chatMode === "terminal" &&
                activeSessionIdForReset === terminal.sessionId &&
                activeTerminalInstanceId === terminal.id;
              return (
                <div
                  key={terminal.id}
                  className={isActiveTerminal ? "h-full min-h-0" : "hidden"}
                >
                  <ChatTerminalSurface
                    ref={(node) => {
                      terminalSurfaceRefs.current[terminal.id] = node;
                      if (!node)
                        delete terminalSurfaceRefs.current[terminal.id];
                    }}
                    active={isActiveTerminal}
                    chatSessionId={terminal.sessionId}
                    transport={terminal.transport}
                    topToolbar={terminalTopControls}
                    onAddToChat={addTerminalContextToChat}
                    onChromeStateChange={(state) => {
                      setTerminalChromeById((existing) => {
                        const current = existing[terminal.id];
                        if (
                          current &&
                          current.statusText === state.statusText &&
                          current.inputLabel === state.inputLabel &&
                          current.inputTone === state.inputTone &&
                          current.actionBusy === state.actionBusy
                        ) {
                          return existing;
                        }
                        return { ...existing, [terminal.id]: state };
                      });
                    }}
                    onConnectionStateChange={(state) => {
                      recordTerminalConnectionState(terminal.id, state);
                    }}
                    onSessionEnded={(snapshot) =>
                      void saveTerminalCheckpoint(terminal, snapshot)
                    }
                  />
                </div>
              );
            })}
          />

          {/* Composer — extracted to chat/surface/Composer (Step 3). All
          state (input, slash menu, mentions, attachments, chips, voice)
          and every handler stay here; the region is presentation-only.
          The context-chip pills render the ChatRailApi `composerInjection`
          contract fed through the effect above. */}
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
            terminalInputLabel={activeTerminalChrome?.inputLabel}
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

          {/* Plugin footer slot — renders nothing until a plugin contributes. */}
          <ChatPluginSlot slot="footer" />

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
        </div>
      </div>
    </ChatPluginProvider>
  );
}
