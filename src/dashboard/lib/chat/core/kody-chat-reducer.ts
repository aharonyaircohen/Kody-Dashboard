// Live-session reducer for KodyChat. One owner of truth for the runner
// lifecycle so the UI can't drift from the runner's actual phase.
//
// Why a reducer (not a useState bag):
//   Before: 5+ independent state pieces (interactiveStateRef, interactiveState,
//   bootStartedAt, pollIntervalRef, eventSourceRef, pendingKickoff). Each event
//   handler mutated some-but-not-all of them, so failures left the UI pinned in
//   booting/awaiting forever ("Kody Live is thinking…" with no recovery).
//
//   After: every event dispatches one action; the reducer enforces invariants
//   (e.g. a chat.message always clears awaiting, a chat.exit always clears the
//   session id, an error always tears down the phase). Watchdog timeouts and
//   status-check results flow through the same dispatch surface.

/**
 * Stable identifier for a chat "scope" (task vs global). Kept as a string
 * alias rather than imported from KodyChat to keep this module pure.
 */
export type LiveScopeKey = string;

export type LivePhase =
  | "idle" // no session in this scope
  | "booting" // /start dispatched, awaiting chat.ready
  | "ready" // runner up, no turn in flight
  | "awaiting" // user sent a turn, awaiting assistant reply
  | "ended" // runner exited cleanly (chat.exit)
  | "error" // start failed, or runner reported chat.error
  | "stuck"; // watchdog or status check declared the runner zombie

export interface LiveTarget {
  owner: string;
  repo: string;
}

export interface PendingKickoff {
  content: string;
  issueNumber: number | null;
}

export interface LiveSessionState {
  phase: LivePhase;
  sessionId: string | null;
  scopeKey: LiveScopeKey;
  target: LiveTarget | null;
  runUrl: string | null;
  /** When booting started; drives the elapsed-time indicator + watchdog. */
  bootStartedAt: number | null;
  /** Local ms of the most recent event observed; drives idle watchdog. */
  lastEventAt: number | null;
  /** Human-readable reason when phase is 'error' or 'stuck'. */
  errorMessage: string | null;
  /** Optional switch-agent kickoff queued by SwitchAgentDirective. */
  pendingKickoff: PendingKickoff | null;
}

export const initialLiveState: LiveSessionState = {
  phase: "idle",
  sessionId: null,
  scopeKey: "global",
  target: null,
  runUrl: null,
  bootStartedAt: null,
  lastEventAt: null,
  errorMessage: null,
  pendingKickoff: null,
};

export type LiveAction =
  // Lifecycle
  | {
      type: "START";
      sessionId: string;
      scopeKey: LiveScopeKey;
      startedAt: number;
    }
  | { type: "START_FAILED"; errorMessage: string }
  | { type: "TARGET_RESOLVED"; target: LiveTarget }
  // Events from runner (poll or SSE — same shape)
  | { type: "RUNNER_READY"; runUrl?: string }
  | { type: "RUNNER_EXIT" }
  | { type: "RUNNER_ERROR"; errorMessage: string }
  | { type: "TURN_SENT" }
  | { type: "TURN_DONE" }
  | { type: "MESSAGE_RECEIVED" }
  | { type: "EVENT_OBSERVED" }
  // Scope changes (Vibe issue switch, etc.)
  | { type: "REHYDRATE_IDLE"; scopeKey: LiveScopeKey }
  | {
      type: "REHYDRATE_RESTORED";
      scopeKey: LiveScopeKey;
      sessionId: string;
      phase: "booting" | "ready";
      bootStartedAt: number | null;
      target: LiveTarget | null;
      runUrl: string | null;
    }
  // Vibe auto-kickoff
  | { type: "KICKOFF_QUEUED"; content: string; issueNumber: number | null }
  | { type: "KICKOFF_FIRED" }
  // Watchdog / status check
  | {
      type: "STATUS_RESULT";
      runnerAlive: boolean;
      lastEventAt: number | null;
      errorMessage?: string;
    }
  | { type: "MARK_STUCK"; errorMessage: string }
  // User actions
  | { type: "FORCE_RESET" }
  | { type: "END" };

export function liveReducer(
  state: LiveSessionState,
  action: LiveAction,
): LiveSessionState {
  switch (action.type) {
    case "START":
      return {
        ...initialLiveState,
        phase: "booting",
        sessionId: action.sessionId,
        scopeKey: action.scopeKey,
        bootStartedAt: action.startedAt,
        lastEventAt: action.startedAt,
      };
    case "START_FAILED":
      return {
        ...state,
        phase: "error",
        errorMessage: action.errorMessage,
        sessionId: null,
        bootStartedAt: null,
      };
    case "TARGET_RESOLVED":
      return { ...state, target: action.target };
    case "RUNNER_READY":
      // Tolerate ready-after-ready (idempotent), and ready-after-awaiting
      // (engine sometimes re-emits when it picks up a queued turn).
      return {
        ...state,
        phase: state.phase === "awaiting" ? "awaiting" : "ready",
        bootStartedAt: null,
        runUrl: action.runUrl ?? state.runUrl,
        lastEventAt: Date.now(),
        errorMessage: null,
      };
    case "RUNNER_EXIT":
      return {
        ...state,
        phase: "ended",
        sessionId: null,
        bootStartedAt: null,
        lastEventAt: Date.now(),
      };
    case "RUNNER_ERROR":
      return {
        ...state,
        phase: "error",
        errorMessage: action.errorMessage,
        lastEventAt: Date.now(),
      };
    case "TURN_SENT":
      // Only transition out of ready/booting — never overwrite ended/error.
      if (state.phase !== "ready" && state.phase !== "booting") return state;
      return { ...state, phase: "awaiting", lastEventAt: Date.now() };
    case "TURN_DONE":
    case "MESSAGE_RECEIVED":
      // The big fix for hazard D: an assistant message or chat.done always
      // returns awaiting → ready, so the spinner can't outlive the reply.
      if (state.phase !== "awaiting") {
        // Still bump lastEventAt so the watchdog stays satisfied.
        return { ...state, lastEventAt: Date.now() };
      }
      return { ...state, phase: "ready", lastEventAt: Date.now() };
    case "EVENT_OBSERVED":
      return state.sessionId ? { ...state, lastEventAt: Date.now() } : state;
    case "REHYDRATE_IDLE":
      return { ...initialLiveState, scopeKey: action.scopeKey };
    case "REHYDRATE_RESTORED":
      return {
        ...initialLiveState,
        scopeKey: action.scopeKey,
        sessionId: action.sessionId,
        phase: action.phase,
        bootStartedAt: action.bootStartedAt,
        target: action.target,
        runUrl: action.runUrl,
        lastEventAt: Date.now(),
      };
    case "KICKOFF_QUEUED":
      return {
        ...state,
        pendingKickoff: {
          content: action.content,
          issueNumber: action.issueNumber,
        },
      };
    case "KICKOFF_FIRED":
      return { ...state, pendingKickoff: null };
    case "STATUS_RESULT": {
      // If the server says the runner is gone and we still think it's alive,
      // demote to 'stuck' so the user gets a Restart affordance.
      const wasActive =
        state.phase === "booting" ||
        state.phase === "ready" ||
        state.phase === "awaiting";
      if (!action.runnerAlive && wasActive) {
        return {
          ...state,
          phase: "stuck",
          errorMessage:
            action.errorMessage ??
            "Runner appears to have stopped without emitting chat.exit.",
          lastEventAt: action.lastEventAt ?? state.lastEventAt,
        };
      }
      // Runner still considered alive. Bump lastEventAt so the watchdog
      // effect re-fires after another deadline — without this, the effect
      // wouldn't re-run (deps haven't changed) and a single false-alarm
      // check would silence the watchdog for the rest of the session.
      return {
        ...state,
        lastEventAt: action.lastEventAt ?? Date.now(),
      };
    }
    case "MARK_STUCK":
      return {
        ...state,
        phase: "stuck",
        errorMessage: action.errorMessage,
      };
    case "FORCE_RESET":
    case "END":
      return { ...initialLiveState, scopeKey: state.scopeKey };
  }
}

// ── Selectors ─────────────────────────────────────────────────────────────

/** Composer should be disabled (runner unreachable or busy). */
export function isComposerLocked(phase: LivePhase): boolean {
  return phase !== "ready";
}

/** Show the assistant typing indicator. */
export function isAwaitingReply(phase: LivePhase): boolean {
  return phase === "awaiting" || phase === "booting";
}

/** UI should surface a "stuck — restart?" affordance. */
export function isRecoverable(phase: LivePhase): boolean {
  return phase === "stuck" || phase === "error" || phase === "ended";
}

/** Phase is one where lack of events would indicate a zombie runner. */
export function isWatchdogActive(phase: LivePhase): boolean {
  return phase === "booting" || phase === "awaiting";
}
