/**
 * @fileType hook
 * @domain kody
 * @pattern kody-chat-live-runner
 * @ai-summary The Kody Live runner lifecycle extracted from KodyChat
 *   (phase 1.6a): the live reducer orchestration (dispatchLive + legacy
 *   ref mirrors), localStorage persistence + scope rehydration effects,
 *   the interactive event poll, the SSE stream (connect/cycle/visibility
 *   gate), the start/end/restart session actions, and the zombie-runner
 *   watchdog. Behavior is identical to the pre-extraction inline code —
 *   UI side effects (agent picker writes, session mirroring) stay in
 *   KodyChat and are injected via the `onRehydrateRestored` callback.
 *
 *   Placement note: this module lives in components/ (not chat/core)
 *   because it necessarily imports the components-zone `Message` type
 *   and the vibe plugin's turn-context helpers — both forbidden imports
 *   for chat/core under the layer zones in eslint.config.mjs. The pure
 *   decision logic it relies on (reducer transitions, persistence
 *   decisions, rehydrate actions) already lives zone-clean in
 *   chat/core/kody-chat-reducer.ts and chat/core/rehydration.ts.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  liveReducer,
  initialLiveState,
  isWatchdogActive,
  type LivePhase,
  type LiveAction,
  type LiveSessionState,
} from "../chat/core/kody-chat-reducer";
import {
  authHeaders,
  getLiveScopeKey,
  loadLiveSession,
  saveLiveSession,
  clearLiveSession,
  liveAuthFor,
  liveAuthHeaders,
  type LiveScopeKey,
} from "../chat/core/kody-chat-live-session";
import {
  buildRehydrateAction,
  decideLivePersistence,
  shouldRehydrateScope,
} from "../chat/core/rehydration";
import { getStoredFlyPerf } from "../api";
import type { AgentId } from "../agents";
import type { ChatContext } from "../chat-types";
import { vibeTurnFields, type VibeLiveTaskContext } from "../chat/plugins/vibe";
import type { Message } from "./kody-chat-types";

type MessagesUpdater = Message[] | ((prev: Message[]) => Message[]);

export interface UseLiveRunnerOptions {
  /** The currently selected agent — drives the Fly vs GHA start route. */
  selectedAgentId: AgentId;
  /** Host chat context (task / capability / goal-planner / …). */
  context: ChatContext | null | undefined;
  vibeMode?: boolean;
  /** Task id when the chat is scoped to a task (drives the scoped SSE). */
  selectedTaskId: string | null;
  /** Capability slug when scoped to a capability (drives the scoped SSE). */
  capabilitySlug: string | null;
  /** The active UI session id events should be written back to. */
  activeSessionIdForReset: string | null;
  /** Chat-level thinking pick forwarded to /interactive/start. */
  effectiveReasoningEffort: string | null;
  setLoading: (loading: boolean) => void;
  /** Write messages into the ACTIVE session. */
  setMessages: (updater: MessagesUpdater) => void;
  /** Write messages into a SPECIFIC session (turns outlive session switches). */
  setMessagesForSession: (sessionId: string, updater: MessagesUpdater) => void;
  /**
   * UI side effects after a saved live session is restored for a scope —
   * KodyChat flips the picker to the Live agent and mirrors the pick onto
   * the active session. Read through a ref so callback identity churn in
   * the host can't destabilize `rehydrateForScope`.
   */
  onRehydrateRestored: (scopeKey: LiveScopeKey) => void;
}

export interface UseLiveRunnerResult {
  liveState: LiveSessionState;
  liveStateRef: React.MutableRefObject<LiveSessionState>;
  dispatchLive: (action: LiveAction) => void;
  /** Legacy synchronous mirrors — post-dispatch reads see fresh values. */
  interactiveSessionIdRef: React.MutableRefObject<string | null>;
  interactiveStateRef: React.MutableRefObject<LivePhase>;
  interactiveTargetRef: React.MutableRefObject<{
    owner: string;
    repo: string;
  } | null>;
  currentScopeKeyRef: React.MutableRefObject<LiveScopeKey>;
  /** Seconds since boot started — drives the booting banner countdown. */
  bootElapsed: number;
  eventSourceRef: React.MutableRefObject<EventSource | null>;
  connectSSE: (
    sessionId: string,
    opts?: { interactive?: boolean; uiSessionId?: string | null },
  ) => void;
  startInteractivePoll: (
    sessionId: string,
    uiSessionId?: string | null,
  ) => void;
  stopInteractivePoll: () => void;
  startInteractiveSession: (opts?: {
    initialContent?: string;
    initialTimestamp?: string;
    taskContext?: VibeLiveTaskContext;
    uiSessionId?: string | null;
  }) => Promise<void>;
  endInteractiveSession: () => void;
  restartInteractiveSession: () => Promise<void>;
  rehydrateForScope: (scopeKey: LiveScopeKey) => void;
}

/**
 * Kody Live (long-lived runner) lifecycle — single reducer owns phase +
 * session id + target + run url + boot timestamp + last-event timestamp +
 * the vibe auto-kickoff queue. Every transition goes through `dispatchLive`,
 * which (a) recomputes the next state, (b) writes a synchronous mirror to
 * `liveStateRef` so closure-captured reads see fresh values immediately,
 * and (c) calls React's setState so the UI re-renders. See
 * kody-chat-reducer.ts for the action surface and transition table.
 *
 * Legacy phases ('idle' | 'booting' | 'ready' | 'ended') are extended with
 * 'awaiting' (turn in flight), 'error' (start failed or chat.error), and
 * 'stuck' (watchdog/status check declared the runner zombie).
 */
export function useLiveRunner({
  selectedAgentId,
  context,
  vibeMode,
  selectedTaskId,
  capabilitySlug,
  activeSessionIdForReset,
  effectiveReasoningEffort,
  setLoading,
  setMessages,
  setMessagesForSession,
  onRehydrateRestored,
}: UseLiveRunnerOptions): UseLiveRunnerResult {
  // Restore an in-progress Kody Live session after a page refresh. Reads
  // localStorage on mount; if a non-stale session exists, switches to the
  // live agent, restores state, and reconnects the SSE so chat.ready /
  // chat.message / chat.exit continue to flow. Runs once.
  const liveRestoreAttemptedRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);

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

  // Legacy refs kept for the many closure readers in KodyChat. Source of
  // truth is `liveStateRef`; these are updated by `dispatchLive` above so
  // a post-dispatch read in the same tick sees the new value.
  const interactiveSessionIdRef = useRef<string | null>(null);
  const interactiveStateRef = useRef<LivePhase>("idle");
  const interactiveTargetRef = useRef<{ owner: string; repo: string } | null>(
    null,
  );
  const currentScopeKeyRef = useRef<LiveScopeKey>("global");

  // Host UI side effects read through a ref — see the option's doc comment.
  const onRehydrateRestoredRef = useRef(onRehydrateRestored);
  onRehydrateRestoredRef.current = onRehydrateRestored;

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
      const writeMessages = (updater: MessagesUpdater) => {
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
    [
      dispatchLive,
      setLoading,
      setMessages,
      setMessagesForSession,
      stopInteractivePoll,
    ],
  );

  // ─── SSE for chat streaming ────────────────────────────────────────────────

  const connectSSE = useCallback(
    (
      sessionId: string,
      opts: { interactive?: boolean; uiSessionId?: string | null } = {},
    ) => {
      // Close any existing connection
      eventSourceRef.current?.close();
      const writeMessages = (updater: MessagesUpdater) => {
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
    [dispatchLive, setLoading, setMessages, setMessagesForSession],
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
      selectedTaskId ??
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
  }, [selectedTaskId, capabilitySlug, connectSSE, activeSessionIdForReset]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Kody Live: warm-up the long-lived runner. Wires the dispatch + SSE
  // for an interactive session. Chat input stays disabled until the runner
  // emits chat.ready (handled in connectSSE).
  const startInteractiveSession = useCallback(
    async (opts?: {
      initialContent?: string;
      initialTimestamp?: string;
      taskContext?: VibeLiveTaskContext;
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
    // Dependency list intentionally matches the pre-extraction KodyChat
    // callback exactly (effectiveReasoningEffort was read from the render
    // closure there too) — behavior-identical is the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Host UI side effects: KodyChat flips the picker to the Live agent
      // and mirrors the pick onto the active session.
      onRehydrateRestoredRef.current(scopeKey);
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

  return {
    liveState,
    liveStateRef,
    dispatchLive,
    interactiveSessionIdRef,
    interactiveStateRef,
    interactiveTargetRef,
    currentScopeKeyRef,
    bootElapsed,
    eventSourceRef,
    connectSSE,
    startInteractivePoll,
    stopInteractivePoll,
    startInteractiveSession,
    endInteractiveSession,
    restartInteractiveSession,
    rehydrateForScope,
  };
}
