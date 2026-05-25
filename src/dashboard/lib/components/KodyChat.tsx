"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { navLabelForPath } from "./settings-nav";
import {
  liveReducer,
  initialLiveState,
  isWatchdogActive,
  type LivePhase,
  type LiveAction,
  type LiveSessionState,
} from "./kody-chat-reducer";
import ReactMarkdown from "react-markdown";
import {
  Globe,
  Paperclip,
  X,
  Image as ImageIcon,
  FileText,
  FileCode,
  MessageSquare,
  History,
  Target,
  Loader2,
  ChevronDown,
  PanelLeftClose,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { AGENT_KODY, AGENTS, type AgentId } from "../agents";
import { buildAgentList, type ChatModelEntry } from "../chat/agent-entries";
import { readDefaultChatEntry } from "../chat/default-entry";
import { getStoredAuth, getStoredBrainConfig, getStoredFlyPerf } from "../api";
import { useAuth } from "../auth-context";
import { toast } from "sonner";
import type { KodyTask } from "../types";
import {
  useSlashCommands,
  parseSlashTrigger,
  expandSlashCommand,
} from "../commands/useSlashCommands";
import { parseGoalMention, type GoalRef } from "../goal-mention";
import { SlashCommandMenu, filterCommands } from "./SlashCommandMenu";
import {
  authHeaders,
  stickyBrainChatId,
  getLiveScopeKey,
  loadLiveSession,
  saveLiveSession,
  clearLiveSession,
  liveAuthFor,
  liveAuthHeaders,
  brainHeaders,
  type LiveScopeKey,
} from "./kody-chat-live-session";
import {
  bootPhaseLabel,
  formatElapsed,
  formatFileSize,
  getFileIcon,
} from "./kody-chat-helpers";
import {
  chatToMessage,
  messageToChat,
  ISSUE_CREATION_TOOL_NAMES,
  type Message,
  type ToolCall,
  type Attachment,
  type KodyChatProps,
} from "./kody-chat-types";
import { MessageAttachments } from "./MessageAttachments";
import { TypingIndicator } from "./TypingIndicator";

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
import { useRemoteStatus } from "../hooks/useRemoteStatus";
import { useVoiceChat } from "../hooks/useVoiceChat";
import { VoiceButton } from "./VoiceButton";
import { VoiceChatOverlay } from "./VoiceChatOverlay";
import { useChatSessions } from "../hooks/useChatSessions";
import { useKodyActionState } from "../hooks/useKodyActionState";
import { SessionSidebar } from "./SessionSidebar";
import { TaskSessionHistory } from "./TaskSessionHistory";
import {
  ToolCallList,
  ThinkingPanel,
  ReasoningPanel,
  parseReasoning,
} from "./ToolCallCard";
import { MessageActions } from "./MessageActions";
import { VibeRunButton } from "./VibeRunButton";
import {
  loadTaskChatLocal,
  saveTaskChatLocal,
  clearTaskChatLocal,
} from "../task-chat-local";
import {
  pickVibeRequestIssueNumber,
  type RecentVibeIssue,
} from "../vibe/recent-issue";
import {
  loadDutyChatLocal,
  saveDutyChatLocal,
  clearDutyChatLocal,
} from "../duty-chat-local";
import { isSwitchAgentDirective } from "@dashboard/lib/chat-ui-actions";

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
}: KodyChatProps) {
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
  const selectedTask: KodyTask | null =
    context?.kind === "task" ? context.task : null;
  const selectedDuty = context?.kind === "duty" ? context.duty : null;
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

  // Task-scoped messages (loaded from / saved to API)
  const [taskMessages, setTaskMessages] = useState<Message[]>([]);
  const [isLoadingTaskChat, setIsLoadingTaskChat] = useState(false);
  // Tracks the task id whose history is currently loaded into `taskMessages`,
  // so the loader can tell a real task switch from a same-task re-fire and
  // avoid blanking the visible thread on transient re-renders.
  const loadedTaskIdRef = useRef<string | null>(null);
  // Duty-scoped messages keyed by duty slug. Ephemeral (lives
  // for the React session) — switching between duties preserves each
  // thread so users can jump around without losing context. Persistence
  // across reloads would need a dedicated save/load API; deferred.
  const [dutyMessagesBySlug, setDutyMessagesBySlug] = useState<
    Record<string, Message[]>
  >({});
  // Goal-planner messages keyed by sessionId (one session per "Plan this
  // goal" launch). Ephemeral — same lifetime as dutyMessagesBySlug.
  const [plannerMessagesBySession, setPlannerMessagesBySession] = useState<
    Record<string, Message[]>
  >({});

  const [input, setInput] = useState("");
  // Slash command autocomplete state. Open while the user is typing the
  // slug portion of `/foo` (no space yet). Once a space is typed the
  // menu closes and we treat the rest of the line as arguments. Enter
  // expands `/slug args` against the prompt list before sending.
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>(
    lockedAgentId ?? "kody-live",
  );
  // When the user picks a gateway-routed model (any LLM_MODELS entry), the
  // dropdown sets `selectedAgentId='kody'` and stashes the gateway id here.
  // The chat request forwards it as `body.model`. Null = no override.
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  // Reactive: re-derives whenever the auth context updates `brain`. Without
  // useAuth this stayed stale because KodyChat lives in the persistent rail
  // and never remounts after Settings saves a Brain config — the dropdown
  // entry wouldn't appear until a full page reload.
  const { auth, loading: authLoading } = useAuth();
  // Slash command list (builtins + repo `.kody/commands/*.md`).
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
  // Mirrors brainConfigured: true only when the per-repo vault holds a
  // non-empty FLY_API_TOKEN. The Fly dropdown row is hidden until then so
  // users can't pick a runner that will fail at start-fly time.
  const [flyConfigured, setFlyConfigured] = useState(false);
  // Per-repo opt-in for the "Kody Brain (Fly)" chat row (.kody/dashboard.json,
  // default false). Chat-only — does NOT gate Fly task execution.
  const [brainFlyChatEnabled, setBrainFlyChatEnabled] = useState(false);
  // User-managed chat models from /api/kody/models (LLM_MODELS variable).
  // Empty until first load completes; renders only Kody Live (+ Brain) in
  // the dropdown while empty.
  const [chatModels, setChatModels] = useState<ChatModelEntry[]>([]);
  // The user-chosen default chat dropdown entry key (any entry: Brain,
  // Brain-Fly, or `kody:<modelId>`), a per-user preference persisted in
  // localStorage (repo-scoped). Read synchronously on mount. Separate from a
  // model's own `default` flag, which governs server-side gateway resolution.
  // Read-only here: the default is now chosen in Settings → "Default chat"
  // and written to the same repo-scoped localStorage key. The chat picker
  // only consumes it (apply-on-load below); it no longer sets it.
  const [defaultChatEntryKey] = useState<string | null>(() =>
    readDefaultChatEntry(),
  );
  // localStorage is synchronous, so the key is known on first render — the
  // apply-on-load effect can run immediately. The flag stays only to keep the
  // Brain auto-default effect's existing gating contract intact.
  const [defaultChatEntryLoaded, setDefaultChatEntryLoaded] = useState(true);
  const brainAbortRef = useRef<AbortController | null>(null);
  // AbortController for the in-process chat path (`/api/kody/chat/kody`).
  // Without this the Stop button can't cancel the in-flight stream — the
  // model keeps generating, tokens keep flowing into the assistant bubble,
  // and the user has no recourse. Mirrors the Brain backend's pattern.
  const kodyAbortRef = useRef<AbortController | null>(null);
  const currentAgent = AGENTS[selectedAgentId] ?? AGENT_KODY;
  const agentList = buildAgentList(
    brainConfigured,
    flyConfigured,
    brainFlyChatEnabled,
    chatModels,
  );
  // Vibe auto-kickoff. When `vibe_start_execution` returns a
  // SwitchAgentDirective with `autoKickoff`, the dashboard records the
  // message + target issue number here so a useEffect can dispatch it
  // *after* the agent flip AND `context.task.issueNumber` matches the
  // target. Without the issue-number gate, the kickoff fires the moment
  // context flips to any task scope — typically the previously-viewed
  // issue, because the tasks query hasn't refetched yet — and the
  // runner gets dispatched against the wrong sessionId (symptom seen
  // in prod: workflow_dispatch logs show `vibe-<oldIssue>-...` and the
  // new issue's PR stays empty).
  // Vibe auto-kickoff queue lives in the live-session reducer (see below);
  // these named getters keep read sites readable.
  // What to show in the header — when a gateway model is active, prefer
  // its label over the static `kody` agent name.
  const currentEntry =
    agentList.find(
      (e) =>
        e.agentId === selectedAgentId &&
        (e.modelId ?? null) === selectedModelId,
    ) ?? null;

  // Auto-default to Brain on first load when it's already configured. Runs
  // once after auth hydrates so we don't preempt the user's later picks.
  // Skipped when the parent locks a specific agent (Vibe page).
  const initialBrainDefaultRef = useRef(false);
  useEffect(() => {
    if (initialBrainDefaultRef.current) return;
    if (lockedAgentId) {
      initialBrainDefaultRef.current = true;
      return;
    }
    if (authLoading) return;
    // Yield to an explicit saved default. The dashboard-config fetch and the
    // auth fetch race; if config resolves first and applies the user's saved
    // entry, this effect must not then stomp it back to Brain when auth
    // settles. Wait for the config load, and once it's known, defer entirely
    // to the explicit-default effect when a key is set (it resolves to
    // "brain" itself if that's the saved choice).
    if (!defaultChatEntryLoaded) return;
    if (defaultChatEntryKey) {
      initialBrainDefaultRef.current = true;
      return;
    }
    if (brainConfigured) {
      setSelectedAgentId("brain");
      setSelectedModelId(null);
    }
    initialBrainDefaultRef.current = true;
  }, [
    authLoading,
    brainConfigured,
    lockedAgentId,
    defaultChatEntryLoaded,
    defaultChatEntryKey,
  ]);

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
      })
      .catch(() => {
        if (!cancelled) setChatModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the repo-wide Brain (Fly) chat toggle once on mount. The default
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

  // Apply the user-chosen default dropdown entry on first load. Beats
  // both Kody Live (the unconditional fallback) and the Brain
  // auto-default — an explicit pick wins over any heuristic. Runs at most
  // once per chat mount; later dropdown picks aren't overridden.
  //
  // Resolution order:
  //   1. The persisted `defaultChatEntryKey` (any entry: Brain, Brain-Fly,
  //      or a Kody model) — matched against the live agentList by key.
  //   2. Legacy fallback: a Kody model still flagged `default` in the
  //      Models page, for users who set a default before this existed.
  const initialDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (lockedAgentId) return;
    if (initialDefaultAppliedRef.current) return;
    if (!defaultChatEntryLoaded) return;

    if (defaultChatEntryKey) {
      const entry = agentList.find((e) => e.key === defaultChatEntryKey);
      if (!entry) {
        // The entry isn't in the list yet — Brain visibility (auth) and
        // Brain-Fly status probe hydrate after models. KEEP WAITING; the
        // effect re-runs as agentList changes. An explicit choice must
        // never be silently overridden by the legacy model.default
        // fallback (that bug landed users on a model after picking Brain).
        // If the entry never appears (Brain unconfigured / model deleted)
        // we simply never apply here and the visible-entry effect settles
        // on Kody Live — correct, since the pick is unavailable anyway.
        return;
      }
      setSelectedAgentId(entry.agentId);
      setSelectedModelId(entry.modelId);
      initialDefaultAppliedRef.current = true;
      return;
    }

    // No explicit key — legacy fallback to a Models-page default model.
    if (chatModels.length === 0) return;
    const def = chatModels.find(
      (m) => m.default === true && m.enabled !== false,
    );
    if (def) {
      setSelectedAgentId("kody");
      setSelectedModelId(def.id);
    }
    initialDefaultAppliedRef.current = true;
  }, [
    agentList,
    defaultChatEntryKey,
    defaultChatEntryLoaded,
    chatModels,
    lockedAgentId,
  ]);

  // Keep the selection on a visible dropdown entry. Live and Live (Fly)
  // share one slot in the dropdown; same for Brain and Brain (Fly). When
  // a probe flips availability, snap the selection to the visible row of
  // the same family — Live↔Live (Fly), Brain↔Brain (Fly) — or to the
  // visible Live row when neither Brain variant is available.
  useEffect(() => {
    if (lockedAgentId) return;
    // Gateway models are policed by a separate effect below.
    if (selectedAgentId === "kody" && selectedModelId) return;
    const liveTarget: AgentId = flyConfigured ? "kody-live-fly" : "kody-live";
    if (
      selectedAgentId === "kody-live" ||
      selectedAgentId === "kody-live-fly"
    ) {
      if (selectedAgentId !== liveTarget) {
        setSelectedAgentId(liveTarget);
        setSelectedModelId(null);
      }
      return;
    }
    if (selectedAgentId === "brain" || selectedAgentId === "brain-fly") {
      const brainTarget: AgentId | null =
        flyConfigured && brainFlyChatEnabled
          ? "brain-fly"
          : brainConfigured
            ? "brain"
            : null;
      if (brainTarget === null) {
        setSelectedAgentId(liveTarget);
        setSelectedModelId(null);
        return;
      }
      if (selectedAgentId !== brainTarget) {
        setSelectedAgentId(brainTarget);
        setSelectedModelId(null);
      }
    }
  }, [
    flyConfigured,
    brainFlyChatEnabled,
    brainConfigured,
    selectedAgentId,
    selectedModelId,
    lockedAgentId,
  ]);

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

  // If the user had a gateway model selected but it was removed from the
  // list (or disabled), fall back to Kody Live so the chat keeps working.
  useEffect(() => {
    if (lockedAgentId) return;
    if (selectedAgentId !== "kody" || selectedModelId === null) return;
    const stillThere = chatModels.some(
      (m) => m.id === selectedModelId && m.enabled !== false,
    );
    if (!stillThere) {
      setSelectedAgentId("kody-live");
      setSelectedModelId(null);
    }
  }, [chatModels, selectedAgentId, selectedModelId, lockedAgentId]);

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
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
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
  // the runner hand-off to the right one. See lib/vibe/recent-issue.ts.
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
    const {
      phase,
      sessionId,
      scopeKey,
      bootStartedAt: at,
      target,
      runUrl,
    } = liveState;
    if ((phase === "booting" || phase === "ready") && sessionId) {
      saveLiveSession(scopeKey, {
        sessionId,
        state: phase,
        startedAt: at ?? Date.now(),
        target: target ?? undefined,
        runUrl: runUrl ?? undefined,
      });
      persistenceMountedRef.current = true;
      return;
    }
    if (!persistenceMountedRef.current) {
      // First render with idle/null state — leave any persisted record
      // alone; the rehydrate effect below will pick it up.
      persistenceMountedRef.current = true;
      return;
    }
    if (
      phase === "ended" ||
      phase === "error" ||
      phase === "stuck" ||
      (phase === "idle" && !sessionId)
    ) {
      clearLiveSession(scopeKey);
    }
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

  // Task session history (loaded from API)
  const [taskSessions, setTaskSessions] = useState<ChatSession[]>([]);
  const [showTaskHistory, setShowTaskHistory] = useState(false);

  // Use session hook for global (non-task) chat. On the Vibe page, the
  // no-task ("default preview") chat lives in its own bucket so it
  // doesn't share history with the dashboard chat — selecting an issue
  // still swaps over to per-task chat as usual.
  const desiredSessionScope: import("../hooks/useChatSessions").ChatSessionScope =
    vibeMode && !selectedTask ? "vibe-default" : "global";
  // Commit scope changes only after they settle. A transient context flip
  // (parent re-render / task refetch momentarily dropping the selection)
  // would otherwise swap useChatSessions to the empty `vibe-default` bucket
  // and wipe the visible history until a manual refresh. A short settle
  // window absorbs flickers (they revert within the same tick) while real
  // user-driven task select/clear persists well past it.
  const [sessionStoreScope, setSessionStoreScope] =
    useState<import("../hooks/useChatSessions").ChatSessionScope>(
      desiredSessionScope,
    );
  useEffect(() => {
    if (desiredSessionScope === sessionStoreScope) return;
    const t = setTimeout(() => setSessionStoreScope(desiredSessionScope), 150);
    return () => clearTimeout(t);
  }, [desiredSessionScope, sessionStoreScope]);
  const sessionHook = useChatSessions(sessionStoreScope);

  // Abort any in-flight stream + reset loading when the active session
  // changes. Without this, switching to (or creating) a new session
  // mid-stream leaks the previous turn's events into the new session's
  // message list — the deltas keep firing after the switch, hit
  // setMessages (which now writes to the new session), and leave the
  // loading flag stuck so the input is disabled. Fires on agent switch
  // too, which is also the correct behaviour (kody-direct, brain,
  // brain-fly, and kody-live all stop on agent flip).
  const activeSessionIdForReset = sessionHook.activeSession?.id ?? null;
  // Track previous values so the reset effect can tell a real switch from the
  // chat's FIRST session being created by the in-flight turn itself.
  const prevSessionIdRef = useRef<string | null>(activeSessionIdForReset);
  const prevAgentIdRef = useRef<string>(selectedAgentId);
  useEffect(() => {
    const prevSession = prevSessionIdRef.current;
    const agentChanged = selectedAgentId !== prevAgentIdRef.current;
    prevSessionIdRef.current = activeSessionIdForReset;
    prevAgentIdRef.current = selectedAgentId;

    // BUG GUARD: sending the first message in a fresh chat (no active session)
    // CREATES a session, flipping this id from null → new. That fired this
    // effect and aborted the very request that triggered it, leaving a silent
    // blank bubble. Only skip the abort for exactly that case — first session
    // created (null → id), same agent, a kody turn already in flight. A real
    // task switch (id → other id) or agent flip still aborts as before.
    const firstSessionCreated =
      prevSession === null &&
      activeSessionIdForReset !== null &&
      !agentChanged &&
      !!kodyAbortRef.current;

    brainAbortRef.current?.abort();
    eventSourceRef.current?.close();
    if (!firstSessionCreated) {
      kodyAbortRef.current?.abort();
      setLoading(false);
      setToolCalls([]);
    }
    // Intentionally omit the abort/setter refs from deps — they are
    // stable refs / setters, and including them would re-fire this
    // effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionIdForReset, selectedAgentId]);

  // Poll action state — detects when Kody is waiting for instructions
  const { state: actionState, isWaiting: isKodyWaiting } = useKodyActionState(
    selectedTask?.id,
  );

  // Mode discriminator. Exactly one of these is true at a time.
  const isTaskMode = !!selectedTask;
  const isDutyMode = !!selectedDuty;
  const isPlannerMode = !!plannerGoal && !!plannerSessionId;
  const isGlobalMode = !isTaskMode && !isDutyMode && !isPlannerMode;

  // Current messages — picked by mode.
  //  • task mode    → `taskMessages`         (loaded/saved via API)
  //  • duty mode → `dutyMessagesBySlug[slug]` (ephemeral, per duty)
  //  • global mode  → `sessionHook`          (localStorage-backed)
  const dutySlug: string | null = selectedDuty?.slug ?? null;
  const currentDutyMessages: Message[] =
    dutySlug != null ? (dutyMessagesBySlug[dutySlug] ?? []) : [];
  const currentPlannerMessages: Message[] =
    plannerSessionId != null
      ? (plannerMessagesBySession[plannerSessionId] ?? [])
      : [];

  const messages: Message[] = isTaskMode
    ? taskMessages
    : isDutyMode
      ? currentDutyMessages
      : isPlannerMode
        ? currentPlannerMessages
        : sessionHook.messages.map(chatToMessage);

  const setMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      if (isTaskMode) {
        setTaskMessages((prev) =>
          typeof updater === "function" ? updater(prev) : updater,
        );
      } else if (isDutyMode && dutySlug != null) {
        setDutyMessagesBySlug((prev) => {
          const prevForDuty = prev[dutySlug] ?? [];
          const next =
            typeof updater === "function" ? updater(prevForDuty) : updater;
          return { ...prev, [dutySlug]: next };
        });
      } else if (isPlannerMode && plannerSessionId != null) {
        setPlannerMessagesBySession((prev) => {
          const prevForSession = prev[plannerSessionId] ?? [];
          const next =
            typeof updater === "function" ? updater(prevForSession) : updater;
          return { ...prev, [plannerSessionId]: next };
        });
      } else {
        sessionHook.setMessages((prevChat: ChatMessage[]) => {
          const newMessages =
            typeof updater === "function"
              ? updater(prevChat.map(chatToMessage))
              : updater;
          return newMessages.map(messageToChat);
        });
      }
    },
    [
      isTaskMode,
      isDutyMode,
      dutySlug,
      isPlannerMode,
      plannerSessionId,
      sessionHook,
    ],
  );

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
    (sessionId: string) => {
      stopInteractivePoll();
      pollWatermarkRef.current = 0;

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
              setMessages((prev) => {
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
              setMessages((prev) => {
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
              setMessages((prev) => {
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
                setMessages((prev) => {
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
                setMessages((prev) => {
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
    [setMessages],
  );

  // ─── SSE for chat streaming ────────────────────────────────────────────────

  const connectSSE = useCallback(
    (sessionId: string, opts: { interactive?: boolean } = {}) => {
      // Close any existing connection
      eventSourceRef.current?.close();

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
              setMessages((prev) => {
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
              setMessages((prev) => {
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
              setMessages((prev) => {
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
              setMessages((prev) => {
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
              setMessages((prev) => {
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
    [setMessages],
  );

  // Open SSE whenever we have a scoped session id — task id for task mode,
  // `duty-{slug}` for duty mode.
  // Global-mode streams are opened on demand inside the send path.
  //
  // Tab-visibility gate: the server-side SSE handler polls GitHub every 3s as
  // a fallback for cross-instance push. With hundreds of background tabs that
  // drains the shared GH rate-limit token. Closing the EventSource on
  // `visibilityState=hidden` halts the server poll (req.signal.abort fires);
  // we reopen on `visible`. Loss of in-flight push events is acceptable —
  // chat history is hydrated from /api/kody/chat/load on next view.
  useEffect(() => {
    const sid =
      selectedTask?.id ??
      (dutySlug != null ? `duty-${dutySlug}` : null) ??
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
      connectSSE(sid);
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
  }, [selectedTask?.id, dutySlug, connectSSE]);

  // Load task chat when task changes.
  //
  // Two-tier hydration: localStorage first (instant, covers branchless tasks
  // whose server save no-ops), then server. Server wins when it has data —
  // it's canonical for any task with a pipeline branch. If the server returns
  // empty, keep whatever local had (the task likely has no branch yet).
  useEffect(() => {
    if (selectedTask) {
      const switchingTask = loadedTaskIdRef.current !== selectedTask.id;
      loadedTaskIdRef.current = selectedTask.id;
      // Tier 1 — local mirror, synchronous, no network.
      const localMsgs = loadTaskChatLocal(selectedTask.id);
      if (localMsgs.length > 0) {
        setTaskMessages(localMsgs.map(chatToMessage));
      } else if (switchingTask) {
        // Only blank when we're genuinely moving to a different task — the
        // old task's messages must not bleed into the new one. For the same
        // task (effect re-fire / transient re-render) keep what's on screen
        // until the server fetch reconciles, so history can't vanish until
        // a manual refresh.
        setTaskMessages([]);
      }

      // Tier 2 — server fetch. Reconcile when it returns.
      setIsLoadingTaskChat(true);
      fetch(`/api/kody/chat/load?taskId=${selectedTask.id}`)
        .then(async (res) => {
          if (!res.ok) return null;
          const data = await res.json();
          return data as { sessions: ChatSession[] } | null;
        })
        .then((data) => {
          if (!data?.sessions) return;

          setTaskSessions(data.sessions);

          const dashboardSessions = data.sessions.filter(
            (s) => s.stage === "dashboard",
          );
          const converted: Message[] = [];
          for (const session of dashboardSessions) {
            for (const msg of session.messages) {
              converted.push({
                role: msg.role,
                content: msg.text,
                timestamp: msg.timestamp,
              });
            }
          }

          // Server wins only when it actually has dashboard messages. Empty
          // server response = branchless task, keep local mirror in place.
          if (converted.length > 0) {
            setTaskMessages(converted);
            // Server is now canonical — drop local mirror.
            clearTaskChatLocal(selectedTask.id);
          }
        })
        .catch(console.error)
        .finally(() => setIsLoadingTaskChat(false));
    } else {
      // Clear task messages when no task
      loadedTaskIdRef.current = null;
      setTaskMessages([]);
      setTaskSessions([]);
    }
  }, [selectedTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only id needed, full object ref changes on every poll

  // Save task chat after each message exchange (debounced)
  const saveTaskChat = useCallback(async () => {
    if (!selectedTask || taskMessages.length === 0) return;

    try {
      const messagesForApi: ChatMessage[] = taskMessages.map((m) => ({
        role: m.role,
        text: m.content,
        timestamp: m.timestamp || new Date().toISOString(),
      }));

      const res = await fetch("/api/kody/chat/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          taskId: selectedTask.id,
          messages: messagesForApi,
        }),
      });

      // If the server actually persisted (branch exists, not the no-branch
      // skip path), drop the local mirror — server is canonical now.
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as {
          success?: boolean;
          skipped?: string;
        } | null;
        if (body?.success && body.skipped !== "no-branch") {
          clearTaskChatLocal(selectedTask.id);
        }
      }
    } catch (err) {
      console.error("Failed to save chat:", err);
      // Non-fatal — local mirror still covers refresh.
    }
  }, [selectedTask?.id, taskMessages]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only id needed, full object ref changes on every poll

  // Mirror task chat to localStorage immediately on every change. Covers
  // branchless tasks (where server save no-ops) and bridges the 2s debounce
  // window before server save fires.
  //
  // Dep is `selectedTask?.id` not `selectedTask` because the parent rebuilds
  // the task object on every poll. Empty taskMessages is a no-op — otherwise
  // a second KodyChat instance (e.g. PreviewModal's panel) that hasn't loaded
  // yet would clobber the localStorage entry written by the active instance.
  useEffect(() => {
    if (!isTaskMode || !selectedTask || taskMessages.length === 0) return;
    const messagesForLocal: ChatMessage[] = taskMessages.map((m) => ({
      role: m.role,
      text: m.content,
      timestamp: m.timestamp || new Date().toISOString(),
    }));
    saveTaskChatLocal(selectedTask.id, messagesForLocal);
  }, [taskMessages, isTaskMode, selectedTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only id needed, full object ref changes on every poll

  // Save after streaming completes — skip saves while loading to avoid race conditions
  useEffect(() => {
    if (isTaskMode && taskMessages.length > 0 && !loading) {
      const timer = setTimeout(saveTaskChat, 2000);
      return () => clearTimeout(timer);
    }
  }, [taskMessages, isTaskMode, loading, saveTaskChat]);

  // Hydrate duty chat from localStorage on slug change. We only hydrate
  // when the in-memory entry for this slug is `undefined` (never seen
  // this session) — once the user starts adding messages, the in-memory
  // store is the source of truth and we don't reread from disk.
  useEffect(() => {
    if (!isDutyMode || !dutySlug) return;
    if (dutyMessagesBySlug[dutySlug] !== undefined) return;
    const local = loadDutyChatLocal(dutySlug);
    if (local.length === 0) return;
    setDutyMessagesBySlug((prev) => {
      if (prev[dutySlug] !== undefined) return prev;
      return { ...prev, [dutySlug]: local.map(chatToMessage) };
    });
  }, [isDutyMode, dutySlug, dutyMessagesBySlug]);

  // Persist duty chat on every change. localStorage write is sync and cheap;
  // no need to debounce. An empty array clears the entry so a deleted /
  // reset thread doesn't haunt future visits.
  useEffect(() => {
    if (!isDutyMode || !dutySlug) return;
    const msgs = currentDutyMessages;
    if (msgs.length === 0) {
      clearDutyChatLocal(dutySlug);
      return;
    }
    saveDutyChatLocal(
      dutySlug,
      msgs.map((m) => ({
        role: m.role,
        text: m.content,
        timestamp: m.timestamp || new Date().toISOString(),
      })),
    );
  }, [isDutyMode, dutySlug, currentDutyMessages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setIsAtBottom(true);
  }, []);

  // Track whether the user is pinned to the bottom. We only auto-scroll on new
  // content when they are — otherwise scrolling up to read history would fight
  // every streamed token. Threshold is generous (80px) to account for the
  // input bar and "new messages" pill overlap.
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distanceFromBottom < 80);
  }, []);

  useEffect(() => {
    if (isAtBottom) scrollToBottom();
  }, [messages, loading, isAtBottom, scrollToBottom]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Garbage-collect IDB attachment blobs that no message references any
  // more. Runs once on mount across all stored sessions plus the current
  // task chat — cheap, since the cursor only reads keys.
  useEffect(() => {
    const referenced = new Set<string>();
    // Global sessions (from the session hook)
    for (const m of sessionHook.messages) {
      m.attachments?.forEach((a) => referenced.add(a.id));
    }
    // Current task chat
    for (const m of taskMessages) {
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
    // Only touch the localStorage session store in real global mode — draft
    // mode is ephemeral and shares nothing with sessionHook.
    if (isGlobalMode) {
      sessionHook.clearActiveSession();
    }

    setMessages([]);
    setToolCalls([]);

    // Drop the live engine session bound to this scope so the next message
    // starts a fresh runner instead of resuming the old one. rehydrate sees
    // no saved record now, closes SSE/poll, and resets live state to idle.
    const liveScope = currentScopeKeyRef.current;
    clearLiveSession(liveScope);
    rehydrateForScope(liveScope);

    // If in task mode, also clear the saved chat
    if (isTaskMode && selectedTask) {
      clearTaskChatLocal(selectedTask.id);
      fetch("/api/kody/chat/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          taskId: selectedTask.id,
          messages: [], // Clear by saving empty
        }),
      }).catch(console.error);
    }
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
      options: { voiceMode?: boolean } = {},
    ): Promise<string | null> => {
      if (!messageContent.trim() && currentAttachments.length === 0)
        return null;

      // Voice mode is a MODALITY. It does NOT swap agents — the user's
      // dropdown choice still drives the brain and tools. The server
      // appends a TTS-friendly overlay to that agent's system prompt
      // when we set `voiceMode: true` on the request. For agents whose
      // backend isn't the in-process chat path (brain, kody-engine,
      // kody-live), we still route through /api/kody/chat/kody for
      // voice — the kody route falls back to AGENT_KODY for those and
      // applies the overlay there.
      const voiceMode = options.voiceMode === true;
      const effectiveAgentId: AgentId = selectedAgentId;

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
      const displayContent = messageContent;

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
      const stripThinkingTags = (content: string): string =>
        content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();

      const priorMessages = messages
        .map((m) => {
          if (m.role !== "assistant") return m;
          if (m.isError) return null;
          if (m.content.startsWith("Error: ")) return null;
          const cleaned = stripThinkingTags(m.content);
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
        },
      ]);

      // Resolve the session id only for backends that actually need one
      // (engine + brain). The kody-direct route is stateless and doesn't
      // use it. We defer createSession() to those branches because calling
      // it eagerly here creates a *second* session — the first setMessages
      // above already auto-created one, but `sessionHook.activeSession` is
      // a stale closure and reads as null, tripping createSession() into
      // splitting user/assistant across two sessions.
      const resolveSessionId = (): string => {
        if (selectedTask) return selectedTask.id;
        if (dutySlug != null) return `duty-${dutySlug}`;
        return sessionHook.activeSession?.id ?? sessionHook.createSession();
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
      //   - 'brain-fly' → per-user Brain auto-provisioned on Fly. Credentials
      //                   are resolved server-side from FLY_API_TOKEN in the
      //                   repo vault. Routes to /api/kody/chat/brain-fly,
      //                   no client-side credentials.
      // Voice mode rides through Brain when the selected agent's
      // `supportsVoice` flag is true (the brain server applies the voice
      // overlay server-side, per the shared contract in
      // src/dashboard/lib/voice/overlay.ts).
      const isBrainAgent =
        selectedAgentId === "brain" || selectedAgentId === "brain-fly";
      if (isBrainAgent) {
        const brainEndpoint =
          selectedAgentId === "brain-fly"
            ? "/api/kody/chat/brain-fly"
            : "/api/kody/chat/brain";
        const brainExtraHeaders: Record<string, string> =
          selectedAgentId === "brain-fly" ? {} : brainHeaders();
        brainAbortRef.current?.abort();
        const abort = new AbortController();
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
        const repoScope = (() => {
          const a = getStoredAuth();
          return a?.owner && a?.repo
            ? `${a.owner.toLowerCase()}/${a.repo.toLowerCase()}`
            : "norepo";
        })();
        const brainLogicalKey = selectedTask
          ? `${repoScope}::task-${selectedTask.id}`
          : selectedDuty
            ? `${repoScope}::duty-${selectedDuty.slug}`
            : `${repoScope}::global-${brainSessionId}`;
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

        // The Brain reply runs to completion server-side. The Vercel proxy is
        // hard-killed at ~300s, so a long turn arrives across several proxy
        // connections: the first POSTs the message, each subsequent attempt
        // re-attaches with the last seen `seq` (and the text shown so far) and
        // Brain replays the gap then live-tails. Bounded so a pathologically
        // stuck turn can't loop forever.
        const MAX_RECONNECTS = 60;
        let latestAssistantText = "";
        let lastSeq = 0;
        try {
          // Held on an object so TS doesn't narrow it to the initializer —
          // the value is mutated inside the applyEvent closure below.
          const turn: {
            outcome: "done" | "error" | "aborted" | "exhausted";
          } = { outcome: "exhausted" };

          for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt++) {
            const isReconnect = attempt > 0;
            const res = await fetch(brainEndpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeaders(),
                ...brainExtraHeaders,
              },
              body: JSON.stringify(
                isReconnect
                  ? {
                      chatId: brainChatId,
                      resumeSince: lastSeq,
                      resumeText: latestAssistantText,
                    }
                  : {
                      chatId: brainChatId,
                      message: messageContent,
                      // Brain has no ambient-context slot either; the route
                      // prefixes this onto the forwarded user message.
                      ...(currentPageRef.current
                        ? { currentPage: currentPageRef.current }
                        : {}),
                      ...(taskContext ? { taskContext } : {}),
                      ...(selectedDuty
                        ? {
                            dutyContext: {
                              slug: selectedDuty.slug,
                              title: selectedDuty.title,
                              body: selectedDuty.body,
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
                    },
              ),
              signal: abort.signal,
            });
            if (!res.ok || !res.body) {
              const errorData = await res
                .json()
                .catch(() => ({ error: `HTTP ${res.status}` }));
              throw new Error(errorData.error || `HTTP ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            // Per-connection: did the proxy ask us to reconnect, and did the
            // turn reach a terminal event on this connection?
            let reconnectRequested = false;

            const applyEvent = (parsed: {
              type?: string;
              role?: string;
              content?: string;
              timestamp?: string;
              error?: string;
              id?: string;
              name?: string;
              input?: Record<string, unknown>;
              seq?: number;
            }) => {
              if (typeof parsed.seq === "number" && parsed.seq > lastSeq) {
                lastSeq = parsed.seq;
              }
              if (parsed.type === "chat.reconnect") {
                // Proxy handed the turn back before the Vercel ceiling (or the
                // upstream connection dropped). Reconnect from `lastSeq`.
                reconnectRequested = true;
                return;
              }
              if (parsed.type === "chat.message") {
                if (
                  parsed.role !== "user" &&
                  typeof parsed.content === "string"
                ) {
                  latestAssistantText = parsed.content;
                }
                setMessages((prev) => {
                  const copy = [...prev];
                  const idx = copy.findIndex(
                    (m) => m.role === "assistant" && m.isLoading,
                  );
                  if (idx >= 0) {
                    // Preserve any toolCalls already attached to the in-flight
                    // message so the thinking panel doesn't flicker on each text
                    // delta.
                    copy[idx] = {
                      ...copy[idx],
                      role: (parsed.role === "user"
                        ? "user"
                        : "assistant") as Message["role"],
                      content: parsed.content ?? "",
                      timestamp: parsed.timestamp ?? copy[idx].timestamp,
                      isLoading: true,
                    };
                  } else {
                    copy.push({
                      role: (parsed.role === "user"
                        ? "user"
                        : "assistant") as Message["role"],
                      content: parsed.content ?? "",
                      timestamp: parsed.timestamp ?? new Date().toISOString(),
                      isLoading: true,
                    });
                  }
                  return copy;
                });
              } else if (parsed.type === "chat.tool_use") {
                // Attach the tool call to the current in-flight assistant
                // message. If the text deltas haven't started yet, create a
                // placeholder loading bubble so the panel has somewhere to live.
                setMessages((prev) => {
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
                        name: parsed.name ?? "tool",
                        arguments: parsed.input ?? {},
                        status: "success",
                      },
                    ],
                  };
                  return copy;
                });
              } else if (parsed.type === "chat.done") {
                turn.outcome = "done";
                setLoading(false);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.isLoading ? { ...m, isLoading: false } : m,
                  ),
                );
              } else if (parsed.type === "chat.error") {
                turn.outcome = "error";
                setLoading(false);
                setMessages((prev) => {
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
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const lastNewline = buf.lastIndexOf("\n");
              if (lastNewline === -1) continue;
              const chunk = buf.slice(0, lastNewline + 1);
              buf = buf.slice(lastNewline + 1);
              for (const line of chunk.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                const raw = line.slice(6).trim();
                if (!raw) continue;
                try {
                  applyEvent(JSON.parse(raw));
                } catch {
                  /* skip malformed */
                }
              }
            }
            await reader.cancel().catch(() => {});

            // The turn finished on this connection — stop reconnecting.
            if (turn.outcome === "done" || turn.outcome === "error") break;
            if (abort.signal.aborted) {
              turn.outcome = "aborted";
              break;
            }
            // Connection ended without a terminal event: either the proxy
            // handed back before the Vercel ceiling (`chat.reconnect`) or the
            // upstream dropped. Either way the turn keeps running on Brain —
            // loop to re-attach from `lastSeq`. `reconnectRequested` is read
            // here only to document intent; we reconnect regardless.
            void reconnectRequested;
          }

          if (turn.outcome === "exhausted") {
            setLoading(false);
            setMessages((prev) => {
              const filtered = prev.filter(
                (m) => !(m.role === "assistant" && m.isLoading),
              );
              return [
                ...filtered,
                {
                  role: "assistant",
                  content:
                    "Error: lost the connection to Brain and couldn't resume the reply after several attempts. The work may still be running — try again in a moment.",
                  isLoading: false,
                  isError: true,
                },
              ];
            });
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
            ? latestAssistantText
                .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
                .trim()
            : latestAssistantText;
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
        }
      }

      // ─── Kody direct backend: in-process LLM stream, no Actions/Brain ───
      // Any agent with backend === 'kody-direct' routes here. Voice on
      // a kody-direct agent rides this branch with `voiceMode: true` on
      // the body so the route appends the voice overlay to the agent's
      // system prompt. Voice on a brain agent rides the Brain branch
      // above and is overlay'd server-side by the brain server.
      if (currentAgent.backend === "kody-direct") {
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
                ...(messageContent.trim()
                  ? [{ type: "text" as const, text: messageContent }]
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
            : messageContent;

        const kodyMessages = [
          ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: userTurnContent },
        ];

        // Fresh AbortController per turn — Stop button calls .abort() on
        // whichever request is in-flight. Cancel any prior controller in
        // the unlikely case a previous turn never settled.
        kodyAbortRef.current?.abort();
        const kodyAbort = new AbortController();
        kodyAbortRef.current = kodyAbort;
        try {
          const res = await fetch("/api/kody/chat/kody", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            signal: kodyAbort.signal,
            body: JSON.stringify({
              messages: kodyMessages,
              task: kodyTaskContext,
              agentId: effectiveAgentId,
              // Voice modality flag. When true the server appends the
              // voice overlay (no markdown, short sentences, etc.) to
              // the selected agent's system prompt and prefers the
              // speech-flagged model if no model is explicitly set.
              ...(voiceMode ? { voiceMode: true } : {}),
              // Vibe flips the system prompt to "you ARE the executor" and
              // strips the @kody dispatch tools. Only meaningful when the
              // chat is hosted on /vibe; the dashboard rail leaves it off.
              ...(vibeMode ? { vibeMode: true } : {}),
              // Forward the user-managed gateway model id when one is
              // active. The server validates against the LLM_MODELS list,
              // so a stale value falls back to the configured default.
              ...(selectedModelId ? { model: selectedModelId } : {}),
              ...(actorLogin ? { actorLogin } : {}),
              // The dashboard page the user is on, so "what am I viewing?"
              // resolves. Surfaced as a `## Current page` system section.
              ...(currentPageRef.current
                ? { currentPage: currentPageRef.current }
                : {}),
              ...(selectedDuty
                ? {
                    duty: {
                      slug: selectedDuty.slug,
                      title: selectedDuty.title,
                      body: selectedDuty.body,
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
            }),
          });

          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => "");
            throw new Error(errText || `HTTP ${res.status}`);
          }

          // The kody route streams Vercel AI SDK UI messages as SSE
          // (`data: {json}\n\n`). Parse incrementally and split into two
          // buffers: `reasoning` (model thought summaries — wrapped in
          // <think>…</think> so ReasoningPanel renders them collapsed)
          // and `text` (the visible answer).
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let sseBuf = "";
          let reasoningBuf = "";
          let textBuf = "";
          // Map of toolCallId → toolName, populated from `tool-input-available`
          // chunks so we can identify the source tool when its
          // `tool-output-available` arrives (the output chunk omits the name).
          const toolNameById = new Map<string, string>();
          // Pending UI directives surfaced by tools. Applied AFTER the stream
          // closes so the assistant bubble settles before the agent flips —
          // otherwise the in-flight message would be re-routed mid-render.
          let pendingSwitchAgent: ReturnType<typeof JSON.parse> | null = null;
          // Issue number returned by a `create_*` / `report_bug` tool, if
          // any. Captured here so we can transfer the in-flight conversation
          // to the new issue's chat store once the stream settles. See the
          // detection block in `tool-output-available` and the post-stream
          // handler that mirrors `pendingSwitchAgent`.
          let pendingCreatedIssue: number | null = null;

          const composeContent = () =>
            (reasoningBuf ? `<think>${reasoningBuf}</think>\n\n` : "") +
            textBuf;

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });

            // Process complete SSE events (separated by blank lines).
            let sep: number;
            while ((sep = sseBuf.indexOf("\n\n")) !== -1) {
              const event = sseBuf.slice(0, sep);
              sseBuf = sseBuf.slice(sep + 2);
              if (!event.startsWith("data:")) continue;
              const payload = event.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const chunk = JSON.parse(payload) as
                  | { type: "text-delta"; delta: string }
                  | { type: "reasoning-delta"; delta: string }
                  | { type: "error"; errorText: string }
                  | {
                      type: "tool-input-start";
                      toolCallId: string;
                      toolName: string;
                    }
                  | {
                      type: "tool-input-available";
                      toolCallId: string;
                      toolName: string;
                      input?: unknown;
                    }
                  | {
                      type: "tool-output-available";
                      toolCallId: string;
                      output: unknown;
                    }
                  | {
                      type: "tool-output-error";
                      toolCallId: string;
                      errorText?: string;
                    }
                  | { type: string };
                if (chunk.type === "text-delta" && "delta" in chunk) {
                  textBuf += chunk.delta;
                } else if (
                  chunk.type === "reasoning-delta" &&
                  "delta" in chunk
                ) {
                  // Voice mode never shows or speaks reasoning. Drop the
                  // chunks at the source so the bubble equals textBuf
                  // and TTS gets exactly what the user reads. Server-side
                  // we also disable thinking when voiceMode is set, but
                  // the SDK can occasionally leak a stray reasoning event
                  // — this is the belt-and-suspenders guard.
                  if (!voiceMode) reasoningBuf += chunk.delta;
                } else if (chunk.type === "error" && "errorText" in chunk) {
                  textBuf += `\n\n[Error] ${chunk.errorText}`;
                } else if (
                  // The AI SDK emits `tool-input-start` *before* it
                  // streams the input deltas, and `tool-input-available`
                  // once the full input has been parsed. Both carry the
                  // toolName for the same toolCallId — capture from
                  // either, since `tool-input-available` can be skipped
                  // in some edge cases (parse errors, providers that
                  // bypass delta streaming). Without this fallback, the
                  // map miss leaves `name` undefined and the issue-
                  // creation detection below silently no-ops.
                  chunk.type === "tool-input-start" &&
                  "toolCallId" in chunk &&
                  "toolName" in chunk
                ) {
                  toolNameById.set(chunk.toolCallId, chunk.toolName);
                } else if (
                  chunk.type === "tool-input-available" &&
                  "toolCallId" in chunk &&
                  "toolName" in chunk
                ) {
                  toolNameById.set(chunk.toolCallId, chunk.toolName);
                  // Push a "running" tool-call chip onto the in-flight
                  // assistant bubble so the user sees live progress as the
                  // model works — same UX as the kody-live runner path.
                  // Without this the chat looks idle while github_search_code
                  // / fetch_url / etc. fire under the hood.
                  const toolInput =
                    "input" in chunk &&
                    chunk.input &&
                    typeof chunk.input === "object"
                      ? (chunk.input as Record<string, unknown>)
                      : {};
                  setMessages((prev) => {
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
                          id: chunk.toolCallId,
                          name: chunk.toolName,
                          arguments: toolInput,
                          status: "running",
                        },
                      ],
                    };
                    return copy;
                  });
                } else if (
                  chunk.type === "tool-output-available" &&
                  "toolCallId" in chunk &&
                  "output" in chunk
                ) {
                  const name = toolNameById.get(chunk.toolCallId);
                  // Any tool may emit a switch directive — not just
                  // `switch_agent`. `vibe_start_execution` embeds one in its
                  // output so the runner hand-off doesn't depend on the
                  // model also calling `switch_agent` (it often skips it
                  // and just narrates "handed off"). Match by shape, not
                  // by tool name.
                  if (isSwitchAgentDirective(chunk.output)) {
                    // Defer the dispatch — see comment on pendingSwitchAgent.
                    pendingSwitchAgent = chunk.output;
                  }
                  // Issue creation: one of the `create_*` / `report_bug`
                  // tools that returned `{ number: <positive int> }` is a
                  // newly opened GitHub issue. Capture so the post-stream
                  // handler can migrate the conversation onto that issue.
                  //
                  // Match on tool NAME only. A shape-based fallback (any
                  // `{ number, url:.../issues/... }`) is too broad — read
                  // tools like `github_get_issue` / `github_list_issues`
                  // and `github_comment_on_issue` return that exact shape
                  // for an EXISTING issue, so during a normal analysis turn
                  // they'd falsely flag a creation and the post-stream
                  // handler would wipe the whole session. Creation is only
                  // ever one of our whitelisted tools, so require the name.
                  if (
                    name &&
                    ISSUE_CREATION_TOOL_NAMES.has(name) &&
                    chunk.output &&
                    typeof chunk.output === "object" &&
                    "number" in chunk.output
                  ) {
                    const out = chunk.output as { number?: unknown };
                    const isIssueNumber =
                      typeof out.number === "number" &&
                      Number.isInteger(out.number) &&
                      out.number > 0;
                    if (isIssueNumber) {
                      pendingCreatedIssue = out.number as number;
                    }
                  }
                  void name;
                  // Flip the matching running chip to "success".
                  setMessages((prev) => {
                    const copy = [...prev];
                    const idx = copy.findIndex(
                      (m) => m.role === "assistant" && m.isLoading,
                    );
                    if (idx < 0) return copy;
                    const existing = copy[idx].toolCalls ?? [];
                    const next = existing.map((tc) =>
                      tc.id === chunk.toolCallId
                        ? { ...tc, status: "success" as const }
                        : tc,
                    );
                    copy[idx] = { ...copy[idx], toolCalls: next };
                    return copy;
                  });
                } else if (
                  chunk.type === "tool-output-error" &&
                  "toolCallId" in chunk
                ) {
                  // Flip the matching running chip to "error" so a failed
                  // tool call is visible instead of staying stuck on
                  // "running" forever.
                  setMessages((prev) => {
                    const copy = [...prev];
                    const idx = copy.findIndex(
                      (m) => m.role === "assistant" && m.isLoading,
                    );
                    if (idx < 0) return copy;
                    const existing = copy[idx].toolCalls ?? [];
                    const next = existing.map((tc) =>
                      tc.id === chunk.toolCallId
                        ? { ...tc, status: "error" as const }
                        : tc,
                    );
                    copy[idx] = { ...copy[idx], toolCalls: next };
                    return copy;
                  });
                }
              } catch {
                // Ignore malformed chunks rather than aborting the stream.
              }
            }

            const content = composeContent();
            setMessages((prev) => {
              const copy = [...prev];
              const idx = copy.findIndex(
                (m) => m.role === "assistant" && m.isLoading,
              );
              if (idx >= 0) {
                copy[idx] = { ...copy[idx], content, isLoading: true };
              }
              return copy;
            });
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
              const hadTools = (m.toolCalls?.length ?? 0) > 0;
              const producedNothing =
                !answer.trim() &&
                !reasoning.trim() &&
                !hadTools &&
                !pendingSwitchAgent;
              copy[idx] = producedNothing
                ? {
                    ...m,
                    isLoading: false,
                    isError: true,
                    content:
                      "Kody returned no response. The model may not be configured for this repo, or it ended the turn without a reply — try again, or check Chat Models in Settings.",
                  }
                : { ...m, isLoading: false };
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
          // Issue-creation transfer: when a `create_*` / `report_bug` tool
          // returned a new issue number on this turn, migrate the running
          // conversation onto that issue's chat store before notifying the
          // host. Without this, the user navigating to the new issue lands
          // in an empty chat — the conversation that birthed the issue is
          // lost because chat is keyed by selected task. We:
          //   1. snapshot the current `messages` (reads latest via setter)
          //   2. mirror to localStorage under the new task's id
          //      (task id == String(issueNumber) for branchless tasks —
          //      see app/api/kody/tasks/route.ts:483)
          //   3. fire a best-effort server save (skips on branchless tasks,
          //      that's OK — the localStorage mirror covers refresh)
          //   4. clear the current scope's buffer so the conversation
          //      doesn't double-up in both global/draft and the new task
          //   5. fire `onIssueCreated` so the host can navigate
          if (pendingCreatedIssue !== null && onIssueCreated) {
            const newIssueNumber = pendingCreatedIssue;
            const taskIdForChat = String(newIssueNumber);
            // Build the transferred chat *from local stream state*, not
            // from React state. We tried `setMessages(c => snapshot = c)`
            // (even wrapped in flushSync) and it didn't reliably capture
            // the current turn's assistant text — the React render hadn't
            // fully committed by the time the snapshot was read. Building
            // from `messages` (the prior turns at click-time, captured in
            // closure), the current user message (`displayContent`), and
            // the streamed assistant text (`composeContent()`) gives us
            // the exact same view the user sees, with zero timing risk.
            const priorForTransfer: ChatMessage[] = messages
              .filter((m) => !m.isLoading && !m.isError)
              .filter((m) => m.content && m.content.trim().length > 0)
              .map((m) => ({
                role: m.role,
                text: m.content,
                timestamp: m.timestamp || new Date().toISOString(),
                ...(m.attachments ? { attachments: m.attachments } : {}),
                ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
              }));
            const userTurnForTransfer: ChatMessage = {
              role: "user",
              text: displayContent,
              timestamp,
              ...(attachmentRefs.length > 0
                ? { attachments: attachmentRefs }
                : {}),
            };
            const assistantTextForTransfer = composeContent();
            const assistantTurnForTransfer: ChatMessage = {
              role: "assistant",
              text: assistantTextForTransfer,
              timestamp: new Date().toISOString(),
            };
            const transferredMessages: ChatMessage[] = [
              ...priorForTransfer,
              userTurnForTransfer,
              ...(assistantTextForTransfer.trim().length > 0
                ? [assistantTurnForTransfer]
                : []),
            ];
            saveTaskChatLocal(taskIdForChat, transferredMessages);
            void fetch("/api/kody/chat/save", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({
                taskId: taskIdForChat,
                messages: transferredMessages,
              }),
            }).catch(() => {
              // Non-fatal — localStorage mirror covers branchless tasks.
            });
            // Clear the source scope so the conversation only lives in
            // one place once the user lands on the new issue. flushSync
            // guarantees the clear commits before navigate fires.
            flushSync(() => {
              setMessages(() => []);
            });
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
          const stripThink = (s: string) =>
            s.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
          const spoken = voiceMode ? stripThink(textBuf) : textBuf.trim();
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
        }
      }

      // ─── Kody Live: long-lived interactive runner ───
      // First send always auto-starts the runner if there's no live session
      // (or the previous one ended). The user message gets queued through
      // /append — the runner reads the session JSONL on its first git pull,
      // so we don't need to wait for chat.ready before queueing.
      if (
        selectedAgentId === "kody-live" ||
        selectedAgentId === "kody-live-fly"
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
                .join("\n\n") + (messageContent ? `\n\n${messageContent}` : "")
            : messageContent;

        const liveTaskContext =
          vibeMode && context?.kind === "task"
            ? {
                issueNumber: context.task.issueNumber,
                ...(context.task.associatedPR
                  ? {
                      prNumber: context.task.associatedPR.number,
                      branch: context.task.associatedPR.head.ref,
                    }
                  : {}),
              }
            : undefined;

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
                "Live runner failed to start. Try again, or check Settings → Fly Runner.",
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
        try {
          const appendRes = await fetch("/api/kody/chat/interactive/append", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...liveAuthHeaders(liveSessionId),
            },
            body: JSON.stringify({
              taskId: liveSessionId,
              content: liveUserContent,
              timestamp,
              // Same as the trigger path: the live runner reads the turn from
              // the session JSONL, so page context travels in the turn.
              ...(currentPageRef.current
                ? { currentPage: currentPageRef.current }
                : {}),
              ...(vibeMode ? { vibeMode: true } : {}),
              ...(vibeMode && context?.kind === "task"
                ? {
                    taskContext: {
                      issueNumber: context.task.issueNumber,
                      ...(context.task.associatedPR
                        ? {
                            prNumber: context.task.associatedPR.number,
                            branch: context.task.associatedPR.head.ref,
                          }
                        : {}),
                    },
                  }
                : {}),
            }),
          });
          if (!appendRes.ok) {
            const body = (await appendRes.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(body.error ?? `HTTP ${appendRes.status}`);
          }
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
      // The engine's trigger workflow expects plain string content. To keep
      // attachment info available on the workflow side without breaking the
      // schema, inline a compact descriptor + base64 into the user turn the
      // same way the previous behavior did.
      const engineUserContent =
        currentAttachments.length > 0
          ? currentAttachments
              .map((a) => {
                const sizeStr = formatFileSize(a.size);
                if (a.mimeType.startsWith("image/")) {
                  return `[Image: ${a.name} (${sizeStr})]\n${a.data}`;
                }
                return `[File: ${a.name} (${a.mimeType}, ${sizeStr})]\n${a.data}`;
              })
              .join("\n\n") + (messageContent ? `\n\n${messageContent}` : "")
          : messageContent;

      const engineMessages = [
        ...priorMessages,
        { role: "user" as const, content: engineUserContent, timestamp },
      ];

      try {
        const triggerRes = await fetch("/api/kody/chat/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
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
            ...(vibeMode ? { vibeMode: true } : {}),
            ...(vibeMode && context?.kind === "task"
              ? {
                  taskContext: {
                    issueNumber: context.task.issueNumber,
                    ...(context.task.associatedPR
                      ? {
                          prNumber: context.task.associatedPR.number,
                          branch: context.task.associatedPR.head.ref,
                        }
                      : {}),
                  },
                }
              : {}),
          }),
        });

        if (!triggerRes.ok) {
          const errorData = await triggerRes.json();
          throw new Error(errorData.error || `HTTP ${triggerRes.status}`);
        }

        // For task chats a separate useEffect opens the SSE on
        // selectedTask.id; global chats (no task) would otherwise never
        // see the engine's reply because nothing watches the session id.
        // Open the stream here so both modes are covered.
        connectSSE(sessionId);
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
      selectedDuty,
      dutySlug,
      isPlannerMode,
      plannerGoal,
      plannerExistingTasks,
      onPlannerTasksCreated,
      setMessages,
      messages,
      selectedAgentId,
      actorLogin,
      sessionHook,
      connectSSE,
    ],
  );

  // Planner auto-kickoff. The "Plan with chat" button is the user's consent
  // to start; landing them on a blank prompt and asking them to type "go" is
  // a wasted click. We fire Pass 1 automatically on first render of a fresh
  // planner session. Guarded by a ref keyed on sessionId so re-renders,
  // mode toggles, and cleared chats can't re-trigger.
  const plannerAutoKickedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPlannerMode || !plannerSessionId || !plannerGoal) return;
    if (plannerAutoKickedRef.current === plannerSessionId) return;
    if (currentPlannerMessages.length > 0) {
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
    currentPlannerMessages.length,
    sendText,
  ]);

  // Kody Live: warm-up the long-lived runner. Wires the dispatch + SSE
  // for an interactive session. Chat input stays disabled until the runner
  // emits chat.ready (handled in connectSSE).
  const startInteractiveSession = useCallback(
    async (opts?: {
      initialContent?: string;
      initialTimestamp?: string;
      taskContext?: {
        issueNumber: number;
        prNumber?: number;
        branch?: string;
      };
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
            // First turn folded into the session-create commit (atomic) so the
            // runner sees it on first read — no racy follow-up append.
            ...(opts?.initialContent
              ? {
                  content: opts.initialContent,
                  timestamp: opts.initialTimestamp,
                  ...(vibeMode ? { vibeMode: true } : {}),
                  ...(vibeMode && opts.taskContext
                    ? { taskContext: opts.taskContext }
                    : {}),
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
        startInteractivePoll(sessionId);
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
      if (!saved) {
        dispatchLive({ type: "REHYDRATE_IDLE", scopeKey });
        return;
      }
      dispatchLive({
        type: "REHYDRATE_RESTORED",
        scopeKey,
        sessionId: saved.sessionId,
        phase: saved.state,
        bootStartedAt: saved.state === "booting" ? saved.startedAt : null,
        target: saved.target ?? null,
        runUrl: saved.runUrl ?? null,
      });
      setSelectedAgentId("kody-live");
      startInteractivePoll(saved.sessionId);
    },
    [startInteractivePoll, stopInteractivePoll, dispatchLive],
  );

  useEffect(() => {
    const nextScope = getLiveScopeKey(context, vibeMode);
    if (
      nextScope === currentScopeKeyRef.current &&
      liveRestoreAttemptedRef.current
    ) {
      return;
    }
    currentScopeKeyRef.current = nextScope;
    liveRestoreAttemptedRef.current = true;
    rehydrateForScope(nextScope);
  }, [context, vibeMode, rehydrateForScope]);

  // Vibe auto-kickoff. `vibe_start_execution` returns a SwitchAgentDirective
  // with `autoKickoff` set; the switch handler stashes that string in
  // `pendingKickoff`. We wait here for the new runner agent AND the new
  // task scope to both land before firing — without either, the runner
  // gets the wrong primer (FRESH instead of FOLLOW-UP) and either idles or
  // opens a second issue.
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

  const sendMessage = async () => {
    if (!input.trim() && attachments.length === 0) return;
    // Expand slash commands before send: `/review` or `/explain foo` →
    // the prompt body with $ARGUMENTS substituted. The model never sees
    // the slash form (every backend just gets normal text). Unknown
    // slugs pass through unchanged so users can still type "/" prefixed
    // text freely.
    const rawInput = input.trim();

    // "Direct chat to a goal by id": if the message mentions a known
    // goal (`#<n>` / `goal:<n>`), re-scope this chat to that goal's
    // planner and keep the rest of the message in the composer for the
    // user to send into the now-goal-scoped thread. Consuming the
    // mention on its own Enter keeps it race-free (the scope swap drives
    // a re-render before anything is sent). A mention of the goal we're
    // already in just strips the token (the `!==` guard skips a
    // redundant re-scope).
    if (onDirectToGoal && knownGoals && knownGoals.length > 0) {
      const mention = parseGoalMention(rawInput, knownGoals);
      if (mention) {
        if (mention.goalId !== plannerGoal?.id) {
          onDirectToGoal(mention.goalId);
        }
        setInput(mention.rest);
        setSlashMenuOpen(false);
        setSlashSelectedIndex(0);
        return;
      }
    }

    // Built-in `/init` — deterministic engine install. Bypasses the LLM
    // entirely: hits the install endpoint, renders the result as a chat
    // message. Anchored to the start so "//init" or text containing
    // "/init" still passes through to normal handling.
    if (/^\/init(\s|$)/.test(rawInput)) {
      setInput("");
      setSlashMenuOpen(false);
      setSlashSelectedIndex(0);
      const force = /\s--force(\s|$)/.test(rawInput);
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { role: "user" as const, content: rawInput, timestamp: now },
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

    const expanded = expandSlashCommand(rawInput, slashCommands);
    const userMessage = expanded ? expanded.text : rawInput;
    setInput("");
    setSlashMenuOpen(false);
    setSlashSelectedIndex(0);
    const currentAttachments = [...attachments];
    setAttachments([]);

    // If Kody is waiting for instructions, route to the action instruction endpoint
    if (isKodyWaiting && selectedTask?.id) {
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
            content: userMessage,
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

    await sendText(userMessage, currentAttachments);
  };

  // ─── Voice chat integration ───

  const handleVoiceSend = useCallback(
    async (transcript: string) => {
      // Voice is a modality, not an agent. We keep the user's selected
      // agent and just flip the voiceMode flag — the server appends the
      // voice overlay onto that agent's system prompt.
      const response = await sendText(transcript, [], { voiceMode: true });
      if (response) voiceChatRef.current?.onResponseComplete(response);
    },
    [sendText],
  );

  const voiceChat = useVoiceChat({ onSendMessage: handleVoiceSend });
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash menu keyboard navigation. Only intercept when the menu is
    // open AND the input still looks like a slug-in-progress (so once
    // the user types a space the menu's gone and normal handling resumes).
    if (slashMenuOpen) {
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
    // Enter or ⌘/Ctrl+Enter sends; Shift+Enter inserts a newline as usual.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
      return;
    }
    // Esc aborts a streaming reply.
    if (e.key === "Escape" && loading) {
      e.preventDefault();
      handleStop();
      return;
    }
    // ↑ on an empty composer recalls the last user message for editing —
    // matches the shell history convention.
    if (e.key === "ArrowUp" && !input && attachments.length === 0) {
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
    if (!isGlobalMode || loading) return;
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
  }, [isGlobalMode, loading, messages, sessionHook, selectedModelId]);

  const handleStop = () => {
    // Cancel every backend the chat can be talking to. Each abort/close
    // is a no-op if that backend wasn't active — calling them all
    // unconditionally keeps the handler simple and the Stop button
    // honest regardless of which agent is selected.
    eventSourceRef.current?.close();
    kodyAbortRef.current?.abort();
    brainAbortRef.current?.abort();
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

  // The "Run Kody on #N" affordance for vibe mode lives in VibeRunButton.
  // It owns its own state + dispatch path (spawns a Fly Machine directly
  // into agent mode, bypassing GH Actions orchestration).

  // Both `kody-live` (GH Actions) and `kody-live-fly` (Fly Machines) use
  // the same interactive session model, so they share this UI state.
  const isKodyLive =
    selectedAgentId === "kody-live" || selectedAgentId === "kody-live-fly";

  // The composer's primary button switches role for Kody Live agents based
  // on whether there's input AND the current session state:
  //   has text          → 'send'  (auto-starts the runner if needed)
  //   empty + idle/end  → 'start' (warm up the runner)
  //   empty + booting   → 'cancel' (abandon the boot attempt)
  //   empty + ready     → 'stop'  (end the live session)
  // For non-Kody-Live agents the button is always 'send' (disabled if empty).
  const hasComposerContent = input.trim().length > 0 || attachments.length > 0;
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

  // Generate placeholder based on mode. The generic (non-task/duty/draft)
  // case is page-aware: on any sidebar page, hint that Kody can answer about
  // that page — Kody knows every dashboard concept, not just duties/tasks.
  // `pageLabel` is derived once at the top of the component.
  const genericPlaceholder = pageLabel
    ? `Ask Kody about ${pageLabel}...`
    : `Ask Kody about any page, duty, or feature...`;
  const placeholder = isKodyLive
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
        : isDutyMode
          ? `Ask about duty \`${selectedDuty?.slug ?? ""}\`...`
          : genericPlaceholder;

  // Send is always enabled for Kody Live (button morphs into start/stop on
  // empty input). For other agents, only enabled when there's content.
  const canSend = hasComposerContent || isKodyLive;

  return (
    <div
      className="relative flex flex-col h-full md:border-l bg-background"
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
      {showSessionSidebar && isGlobalMode && (
        <SessionSidebar
          sessions={sessionHook.sessions}
          activeSessionId={sessionHook.activeSession?.id || null}
          onSwitchSession={(id) => {
            sessionHook.switchSession(id);
            setShowSessionSidebar(false);
          }}
          onCreateSession={() => {
            sessionHook.createSession();
            setShowSessionSidebar(false);
          }}
          onDeleteSession={sessionHook.deleteSession}
          onRenameSession={sessionHook.renameSession}
          onPinSession={sessionHook.pinSession}
          onClose={() => setShowSessionSidebar(false)}
          className="absolute left-0 top-0 bottom-0 w-full sm:w-72 z-50 shadow-lg"
        />
      )}
      {/* Voice Chat Overlay */}
      {voiceOverlayOpen && (
        <VoiceChatOverlay
          state={voiceChat.state}
          currentTranscript={voiceChat.currentTranscript}
          turnCount={voiceChat.turnCount}
          error={voiceChat.error}
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
      {/* Header with context */}
      <div className="px-2 py-1.5 sm:px-4 sm:py-3 border-b bg-gradient-to-r from-muted/80 to-muted/40">
        <div className="flex items-center justify-between">
          {/* Left: agent picker (locked label when parent forces an agent) */}
          <div className="relative flex items-center gap-2">
            {(() => {
              // Header label/icon prefers the matched dropdown entry — that
              // way a user-managed model surfaces its own label (e.g.
              // "Claude Sonnet 4.6") rather than the generic "Kody" agent
              // name. Falls back to the static agent for locked views or
              // when the selection points at a model that was just removed.
              const headerIcon = currentEntry?.icon ?? currentAgent.icon;
              const headerName = currentEntry?.name ?? currentAgent.name;
              return lockedAgentId ? (
                <div
                  className="flex items-center gap-2 px-2 py-1"
                  title={`${headerName} (locked for this view)`}
                  aria-label={`${headerName} (locked)`}
                >
                  {(() => {
                    const Icon = headerIcon;
                    return <Icon className="w-5 h-5" aria-label={headerName} />;
                  })()}
                  <span className="font-semibold text-base">{headerName}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAgentMenuOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-haspopup="listbox"
                  aria-expanded={agentMenuOpen}
                  title={`Switch assistant (current: ${headerName})`}
                >
                  {(() => {
                    const Icon = headerIcon;
                    return <Icon className="w-5 h-5" aria-label={headerName} />;
                  })()}
                  <span className="font-semibold text-base">{headerName}</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              );
            })()}
            {messages.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                {messages.length}
              </span>
            )}
            {!lockedAgentId && agentMenuOpen && (
              <ul
                role="listbox"
                className="absolute top-full left-0 mt-1 z-30 min-w-[260px] rounded-md border bg-popover shadow-md"
              >
                {agentList.map((a) => {
                  const isSelected =
                    a.agentId === selectedAgentId &&
                    (a.modelId ?? null) === selectedModelId;
                  return (
                    <li key={a.key}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAgentId(a.agentId);
                          setSelectedModelId(a.modelId);
                          setAgentMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-start gap-2 ${
                          isSelected ? "bg-accent/50" : ""
                        }`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        {(() => {
                          const Icon = a.icon;
                          return (
                            <Icon
                              className="w-4 h-4 mt-0.5"
                              aria-hidden="true"
                            />
                          );
                        })()}
                        <span className="flex flex-col flex-1 min-w-0">
                          <span className="font-medium">{a.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {a.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Remote dev status indicator — only visible when configured */}
          {remoteStatus?.configured && (
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground"
              title={
                remoteStatus.online
                  ? "Remote dev: online"
                  : "Remote dev: offline"
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${remoteStatus.online ? "bg-green-500" : "bg-red-400"}`}
                aria-label={
                  remoteStatus.online
                    ? "Remote dev online"
                    : "Remote dev offline"
                }
              />
              <span className="hidden sm:inline">
                {remoteStatus.online ? "Remote" : "Offline"}
              </span>
            </div>
          )}

          {/* Right: Action buttons (session sidebar, task history) */}
          <div className="flex items-center gap-1">
            {/* New chat — visible in duty + planner modes (global has its own
                Chats sidebar; task mode persists to the task). Clears the
                active scope's ephemeral buffer so the user can start over. */}
            {(isDutyMode || isPlannerMode) && messages.length > 0 && (
              <button
                onClick={() => {
                  setMessages([]);
                  setToolCalls([]);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-transparent text-muted-foreground hover:text-foreground hover:bg-background hover:border-border transition-all"
                title="Start a fresh chat in this scope"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New chat</span>
              </button>
            )}

            {/* Session sidebar toggle (global mode only) */}
            {isGlobalMode && (
              <button
                onClick={() => setShowSessionSidebar(!showSessionSidebar)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all ${
                  showSessionSidebar
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-background border-transparent hover:border-border"
                }`}
                title="Conversations"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Chats</span>
              </button>
            )}

            {/* Task history toggle (task mode only) */}
            {isTaskMode && taskSessions.length > 0 && (
              <button
                onClick={() => setShowTaskHistory(!showTaskHistory)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all ${
                  showTaskHistory
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-background border-transparent hover:border-border"
                }`}
                title="Session History"
              >
                <History className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">History</span>
              </button>
            )}

            {/* Fullscreen / restore (desktop rail only) */}
            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-label={
                  railFullscreen
                    ? "Restore chat width"
                    : "Expand chat fullscreen"
                }
                title={railFullscreen ? "Restore" : "Fullscreen"}
                className="ml-1 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-background border border-transparent hover:border-border transition-all"
              >
                {railFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Collapse to a strip (desktop rail only) */}
            {onCollapseRail && (
              <button
                type="button"
                onClick={onCollapseRail}
                aria-label="Collapse chat"
                title="Collapse"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-background border border-transparent hover:border-border transition-all"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}

            {/* Close (mobile sheet) — only when an onClose handler is provided */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close chat"
                title="Close"
                className="ml-1 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-background border border-transparent hover:border-border transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Context bar: task, duty, duty draft, or global */}
        <div className="mt-1 sm:mt-2">
          {isTaskMode && selectedTask ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-1.5 py-0.5 bg-primary text-primary-foreground rounded font-medium">
                #{selectedTask.issueNumber}
              </span>
              <span className="truncate text-muted-foreground">
                {selectedTask.title}
              </span>
            </div>
          ) : isDutyMode && selectedDuty ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded font-medium inline-flex items-center gap-1">
                <Target className="w-3 h-3" />
                {selectedDuty.slug}
              </span>
              <span className="truncate text-muted-foreground">
                {selectedDuty.title}
              </span>
            </div>
          ) : isPlannerMode && plannerGoal ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-1.5 py-0.5 bg-sky-500/15 text-sky-400 rounded font-medium inline-flex items-center gap-1">
                Planning
              </span>
              <span className="truncate text-muted-foreground flex-1 min-w-0">
                {plannerGoal.name}
              </span>
              {onPlannerExit ? (
                <button
                  type="button"
                  onClick={onPlannerExit}
                  className="shrink-0 text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-accent"
                  aria-label="Stop planning this goal"
                  title="Stop planning"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>
          ) : (
            (() => {
              const sessionTitle = sessionHook.activeSession?.title;
              const hasRealTitle =
                !!sessionTitle && sessionTitle !== "New conversation";
              return (
                <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Globe className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {hasRealTitle
                      ? sessionTitle
                      : "Global chat — not tied to any task"}
                  </span>
                </div>
              );
            })()
          )}
        </div>
      </div>

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
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-auto px-1.5 py-2 sm:p-4 space-y-4 relative"
      >
        {messages.length === 0 && !loading && !isLoadingTaskChat && (
          <div className="text-center text-muted-foreground text-base py-8">
            {isTaskMode ? (
              <>
                <p className="font-medium">Chat about this task</p>
                <p className="text-sm mt-1">
                  Messages will be saved to the task
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
                      sharper <span className="font-mono">@kody fix</span> for
                      your approval.
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
                      Draft a follow-up <span className="font-mono">@kody</span>{" "}
                      instruction
                    </span>
                  </li>
                </ul>
              </>
            ) : isDutyMode && selectedDuty ? (
              <>
                <p className="font-medium text-foreground">
                  Chat about `{selectedDuty.slug}`
                </p>
                <p className="text-sm mt-1 max-w-sm mx-auto">
                  Ask anything about this duty&apos;s intent, scope, or rules.
                  Each duty has its own thread.
                </p>
              </>
            ) : isPlannerMode && plannerGoal ? (
              <>
                <p className="font-medium text-foreground">
                  Plan tasks for &ldquo;{plannerGoal.name}&rdquo;
                </p>
                <p className="text-sm mt-1 max-w-md mx-auto">
                  Say <span className="font-mono">&quot;plan it&quot;</span> (or
                  paste extra context first). I&apos;ll propose a task list, you
                  approve, then I&apos;ll deepen each spec and create the issues
                  attached to this goal.
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
                      Diagnose a Kody PR that didn&apos;t fully solve its issue
                      — try{" "}
                      <span className="font-mono">
                        &quot;diagnose PR #1404&quot;
                      </span>
                    </span>
                  </li>
                </ul>
              </>
            )}
          </div>
        )}

        {isLoadingTaskChat && (
          <div className="text-center text-muted-foreground text-sm py-8">
            Loading conversation...
          </div>
        )}

        {/* Task session history (task mode) */}
        {isTaskMode && showTaskHistory && taskSessions.length > 0 && (
          <div className="mb-4">
            <TaskSessionHistory sessions={taskSessions} />
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            data-role={msg.role}
            className={`group flex ${msg.role === "user" ? "justify-end" : "justify-start"} relative`}
          >
            <div
              className={`max-w-[92%] sm:max-w-[85%] min-w-0 break-words rounded-lg px-3 py-2 text-[17px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {/* Message Actions */}
              <MessageActions
                role={msg.role}
                content={msg.content}
                isLast={i === messages.length - 1}
                isLoading={!!msg.isLoading}
                hasToolCalls={!!msg.toolCalls && msg.toolCalls.length > 0}
                onCopy={() => msg.content}
                onRetry={
                  msg.role === "assistant" && i === messages.length - 1
                    ? () => {
                        // Walk back to the last user message. Drop both that
                        // user turn AND the failed assistant reply — sendText
                        // pushes a fresh user bubble, so trimming both keeps
                        // the transcript intact (no duplicate user msg).
                        let userIdx = -1;
                        for (let j = i - 1; j >= 0; j--) {
                          if (messages[j].role === "user") {
                            userIdx = j;
                            break;
                          }
                        }
                        if (userIdx < 0) return;
                        const lastUserContent = messages[userIdx].content;
                        setMessages((prev) => prev.slice(0, userIdx));
                        void sendText(lastUserContent, []);
                      }
                    : undefined
                }
                onEdit={
                  msg.role === "user"
                    ? (content) => {
                        // Drop the edited user msg + everything after it,
                        // then resubmit. sendText repushes the user bubble
                        // with the new content, so we don't keep the old one.
                        setMessages((prev) => prev.slice(0, i));
                        void sendText(content, []);
                      }
                    : undefined
                }
                onDelete={() => {
                  setMessages((prev) => prev.filter((_, idx) => idx !== i));
                }}
              />

              {msg.role === "assistant" ? (
                <>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <ThinkingPanel
                      toolCalls={msg.toolCalls}
                      isStreaming={!!msg.isLoading}
                      persistKey={
                        sessionHook.activeSession?.id && !msg.isLoading
                          ? `${sessionHook.activeSession.id}:${msg.timestamp ?? i}`
                          : undefined
                      }
                    />
                  )}
                  {(() => {
                    const { reasoning, answer } = parseReasoning(msg.content);
                    const isActive = loading && i === messages.length - 1;
                    const hasAnswer = answer.trim().length > 0;
                    return (
                      <>
                        {reasoning && (
                          <ReasoningPanel
                            content={reasoning}
                            isStreaming={!!msg.isLoading}
                            persistKey={
                              sessionHook.activeSession?.id && !msg.isLoading
                                ? `${sessionHook.activeSession.id}:${msg.timestamp ?? i}`
                                : undefined
                            }
                          />
                        )}
                        {hasAnswer && (
                          <div className="prose prose-base dark:prose-invert max-w-none break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words">
                            <ReactMarkdown>{answer}</ReactMarkdown>
                          </div>
                        )}
                        {/* Never a blank bubble: while the turn is in flight and
                            no visible answer text has arrived yet, show the
                            thinking indicator. Covers the reasoning-only /
                            tool-call phase where content is just <think> blocks. */}
                        {isActive && !hasAnswer && (
                          <TypingIndicator label={currentAgent.name} />
                        )}
                      </>
                    );
                  })()}
                </>
              ) : (
                <>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <MessageAttachments attachments={msg.attachments} />
                  )}
                  {msg.content}
                </>
              )}
              {loading &&
                i === messages.length - 1 &&
                msg.role === "assistant" &&
                parseReasoning(msg.content).answer.trim() && (
                  <span className="inline-block ml-2 animate-pulse text-primary">
                    ●
                  </span>
                )}
            </div>
          </div>
        ))}

        {/* Typing indicator shown before an assistant placeholder exists.
            Covers the Kody-engine first-byte window where the placeholder is
            only pushed once the first SSE event arrives. */}
        {loading &&
          messages.length > 0 &&
          messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="max-w-[92%] sm:max-w-[85%] rounded-lg px-3 py-2 bg-muted">
                <TypingIndicator label={currentAgent.name} />
              </div>
            </div>
          )}

        {/* Tool calls display - using ToolCallList component */}
        {toolCalls.length > 0 && (
          <div className="flex justify-start">
            <ToolCallList
              toolCalls={toolCalls.map((tc) => ({
                name: tc.name,
                arguments: tc.arguments,
                result: tc.result,
                status: tc.status,
                startedAt: tc.startedAt,
                durationMs: tc.durationMs,
              }))}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* "Jump to latest" pill — visible only when the user has scrolled up
          and is therefore not pinned to the bottom. Clicking re-engages
          sticky scrolling. */}
      {!isAtBottom && (
        <div className="relative">
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="absolute -top-12 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:opacity-90 transition-opacity"
            aria-label="Jump to latest messages"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            {loading ? "New messages" : "Jump to latest"}
          </button>
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="px-2 sm:px-3 pb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-md text-xs"
            >
              {getFileIcon(attachment.mimeType)}
              <span className="max-w-[100px] truncate">{attachment.name}</span>
              <span className="text-muted-foreground">
                {formatFileSize(attachment.size)}
              </span>
              <button
                onClick={() => removeAttachment(attachment.id)}
                className="ml-1 hover:text-destructive"
                disabled={loading}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="px-1.5 py-2 sm:p-3 border-t">
        {/* Vibe mode: explicit one-shot execution action. Sits with the
            composer so the executor handoff feels like a chat affordance
            rather than a UI button parked elsewhere. Hides itself once
            any work has started. */}
        {vibeMode && context?.kind === "task" && !isKodyLive ? (
          <VibeRunButton task={context.task} />
        ) : null}
        {/* Kody Live warm-up banner — only visible when the live agent is
            selected and the runner isn't currently ready to accept messages. */}
        {isKodyLive && interactiveState !== "ready" ? (
          <div
            className={`mb-2 flex items-center justify-between gap-2 rounded-md border p-2 text-sm ${
              interactiveState === "booting" || interactiveState === "awaiting"
                ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-900 dark:text-yellow-100"
                : interactiveState === "stuck" || interactiveState === "error"
                  ? "border-red-500/50 bg-red-500/10 text-red-900 dark:text-red-100"
                  : "border-border bg-muted/40"
            }`}
          >
            <div className="flex items-center gap-2">
              {interactiveState === "booting" ? (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                    <span>
                      {bootPhaseLabel(
                        bootElapsed,
                        selectedAgentId === "kody-live-fly" ? "fly" : "gh",
                      )}{" "}
                      · {formatElapsed(bootElapsed)} elapsed
                    </span>
                  </div>
                  {interactiveTarget && selectedAgentId !== "kody-live-fly" ? (
                    <a
                      href={
                        interactiveRunUrl ??
                        `https://github.com/${interactiveTarget.owner}/${interactiveTarget.repo}/actions/workflows/kody.yml`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-yellow-700 underline hover:text-yellow-900 dark:text-yellow-300 dark:hover:text-yellow-100"
                    >
                      {interactiveRunUrl
                        ? `Watching ${interactiveTarget.owner}/${interactiveTarget.repo} → run ↗`
                        : `Watching ${interactiveTarget.owner}/${interactiveTarget.repo} → Actions ↗`}
                    </a>
                  ) : null}
                </div>
              ) : interactiveState === "ended" ? (
                <span className="text-muted-foreground">
                  Live runner ended. Start a new session to chat.
                </span>
              ) : interactiveState === "stuck" ||
                interactiveState === "error" ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-red-700 dark:text-red-300">
                    Runner stuck — restart?
                  </span>
                  {liveState.errorMessage ? (
                    <span className="text-xs text-red-600/80 dark:text-red-400/80">
                      {liveState.errorMessage}
                    </span>
                  ) : null}
                </span>
              ) : interactiveState === "awaiting" ? (
                <span className="text-muted-foreground">
                  Live runner is processing — waiting for reply...
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Live runner is offline. Start it to enable chat.
                </span>
              )}
            </div>
            {/* Stuck/error get a one-click recovery affordance — clears the
                dead session and immediately kicks off /start, so the user
                doesn't have to manually click Stop then Start. */}
            {interactiveState === "stuck" || interactiveState === "error" ? (
              <button
                type="button"
                onClick={() => void restartInteractiveSession()}
                className="ml-2 rounded-md bg-red-600/90 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                Restart
              </button>
            ) : null}
          </div>
        ) : null}
        {isKodyLive && interactiveState === "ready" ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-green-500/40 bg-green-500/10 p-2 text-xs text-green-900 dark:text-green-100">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                <span>
                  Live runner ready. Chat normally — clear the box and hit Stop
                  to end.
                </span>
              </div>
              {selectedAgentId !== "kody-live-fly" &&
              (interactiveRunUrl || interactiveTarget) ? (
                <a
                  href={
                    interactiveRunUrl ??
                    (interactiveTarget
                      ? `https://github.com/${interactiveTarget.owner}/${interactiveTarget.repo}/actions/workflows/kody.yml`
                      : "#")
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-green-800 underline hover:text-green-950 dark:text-green-200 dark:hover:text-green-50"
                >
                  {interactiveRunUrl
                    ? "View run on GitHub ↗"
                    : "View workflow on GitHub ↗"}
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex gap-2 items-center">
          {/* Attachment button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.json,.js,.ts,.jsx,.tsx,.html,.css,.scss,.yaml,.yml,.sh"
            onChange={handleFileSelect}
            className="hidden"
            disabled={loading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="Attach files"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          {/* Voice button — gated on `agent.supportsVoice`. Each agent
              declares whether its backend can honor the voice overlay
              (see AgentConfig.supportsVoice). Brain agents support it
              once the brain server applies the overlay server-side;
              kody-live/engine agents don't (latency). The mic stays
              hidden for unsupported agents so the dropdown never lies. */}
          <VoiceButton
            isActive={voiceOverlayOpen}
            isSupported={voiceChat.isSupported && currentAgent.supportsVoice}
            onTap={() => {
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
            onLongPressStart={() => {
              voiceChat.startConversation();
              setVoiceOverlayOpen(true);
            }}
            onLongPressEnd={() => {
              /* let conversation handle it */
            }}
            disabled={loading}
          />
          <div className="flex-1 relative">
            {slashMenuOpen && (
              <SlashCommandMenu
                commands={slashCommands}
                filter={parseSlashTrigger(input).filter}
                selectedIndex={slashSelectedIndex}
                onSelect={applySlashSelection}
                onHover={setSlashSelectedIndex}
              />
            )}
            <textarea
              value={input}
              onChange={(e) => {
                const next = e.target.value;
                setInput(next);
                // Slash menu opens on `/` at line start, stays open while
                // the user types the slug, closes when they add a space
                // or clear the slash.
                const trigger = parseSlashTrigger(next);
                setSlashMenuOpen(trigger.active && slashCommands.length > 0);
                if (trigger.active) setSlashSelectedIndex(0);
                // Auto-expand height
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={() => {
                // Small delay so the menu's onMouseDown can fire before
                // close — onMouseDown uses preventDefault to avoid blur,
                // but defensive close keeps stale menus from hanging.
                setTimeout(() => setSlashMenuOpen(false), 120);
              }}
              placeholder={placeholder}
              rows={1}
              className="w-full px-3 py-2 text-base rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || (isKodyLive && interactiveState !== "ready")}
              style={{ height: "auto" }}
            />
          </div>
          {loading ? (
            <button
              onClick={handleStop}
              className="px-3 py-2 text-base bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
            >
              Stop
            </button>
          ) : composerAction === "stop" || composerAction === "cancel" ? (
            <button
              type="button"
              onClick={endInteractiveSession}
              className="px-3 py-2 text-base bg-destructive/85 text-destructive-foreground rounded-md hover:bg-destructive/95"
              title={
                composerAction === "cancel"
                  ? "Abandon this boot attempt. The runner will idle-exit on its own."
                  : "End this live session. The runner will idle-exit on its own."
              }
            >
              {composerAction === "cancel" ? "Cancel" : "Stop"}
            </button>
          ) : composerAction === "start" ? (
            <button
              type="button"
              onClick={() => void startInteractiveSession()}
              className="px-3 py-2 text-base bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              title="Warm up the live runner now (boots in ~30–60s)."
            >
              Start
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!canSend}
              className="px-3 py-2 text-base bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
        {/* Clear history link */}
        {messages.length > 0 && !loading && (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear history
          </button>
        )}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear history"
        description="Clear conversation history? This cannot be undone."
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={executeClearHistory}
        onClose={() => setShowClearConfirm(false)}
      />
    </div>
  );
}
