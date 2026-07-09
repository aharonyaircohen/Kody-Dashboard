/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern connection-engine
 * @ai-summary Remote (Fly/Brain) terminal connection engine, extracted from
 *   ChatTerminalSurface in Step 5a. All mutable connection state already
 *   lived in React refs, so the engine operates on a deps ref
 *   (`{ current: FlyConnectionDeps }`) the component keeps fresh each
 *   render — async callbacks always read live state, exactly like the old
 *   in-component closures. Guards preserved verbatim: connect
 *   seq/in-flight/failure keys, input-ack timeout → reconnect, restore
 *   blocks input, reconnect-once notice, bounded fetches.
 */
import { getStoredBrainTerminalActivityLimit } from "../../../api";
import { authHeaders } from "../../core/kody-chat-live-session";
import {
  parseTerminalBridgeServerMessage,
  type TerminalBridgeClientMessage,
} from "../../../terminal/bridge-protocol";
import {
  brainImageMismatchNotices,
  type FlySessionWarning,
} from "./terminal-text";
import type {
  ChatTerminalConnectionState,
  ChatTerminalTransport,
  TerminalInputSignal,
} from "./types";

export const TERMINAL_RESIZE_TIMEOUT_MS = 3_000;
export const TERMINAL_INPUT_TIMEOUT_MS = 8_000;
export const TERMINAL_STOP_TIMEOUT_MS = 8_000;
export const LOCAL_OUTPUT_WAIT_MS = 1_500;
export const LOCAL_OUTPUT_READ_TIMEOUT_MS = 5_000;
export const TERMINAL_START_TIMEOUT_MS = 20_000;
export const FLY_CONNECT_TIMEOUT_MS = 75_000;
export const FLY_RECONNECT_DELAY_MS = 750;

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    window.clearTimeout(timeout),
  );
}

export function isRemoteTerminalTransport(
  transport: ChatTerminalTransport,
): transport is Exclude<ChatTerminalTransport, { type: "local" }> {
  return transport.type === "fly" || transport.type === "brain";
}

export function transportKey(transport: ChatTerminalTransport): string {
  if (transport.type === "brain") return "brain";
  if (transport.type === "fly")
    return `fly:${transport.app}:${transport.machineId}`;
  return "local";
}

/** Input signal shown for each remote connection state (restore blocks input). */
export function inputSignalForConnectionState(
  state: ChatTerminalConnectionState,
): TerminalInputSignal | null {
  if (state === "connected") return { tone: "ready", label: "Ready for input" };
  if (state === "restoring")
    return { tone: "blocked", label: "Restoring terminal" };
  if (state === "connecting")
    return { tone: "blocked", label: "Waiting for terminal" };
  if (state === "closed" || state === "error")
    return { tone: "blocked", label: "Input blocked" };
  return null;
}

/**
 * Skip a redundant connect attempt: same target already failed (until
 * forced), already connecting for the same key, or the existing connection
 * for the same target is connecting/RESTORING/connected. Never reopens a
 * remote terminal while the existing connection is restoring.
 */
export function shouldSkipFlyConnect(args: {
  force: boolean;
  attemptKey: string;
  failureKey: string | null;
  inFlightKey: string | null;
  targetKey: string | null;
  connectKey: string;
  existingState: ChatTerminalConnectionState;
}): boolean {
  if (args.force) return false;
  if (args.failureKey === args.attemptKey) return true;
  if (args.inFlightKey === args.attemptKey) return true;
  return (
    args.targetKey === args.connectKey &&
    (args.existingState === "connecting" ||
      args.existingState === "restoring" ||
      args.existingState === "connected")
  );
}

/** Whether the activity limit knob applies to this remote transport. */
export function shouldSendBrainActivityLimit(
  transport: Exclude<ChatTerminalTransport, { type: "local" }>,
): boolean {
  return (
    transport.type === "brain" ||
    (transport.type === "fly" &&
      (transport.feature === "brain" || transport.feature === undefined))
  );
}

/** Body for POST /api/kody/terminal/session — pure so it is testable. */
export function buildFlySessionRequest(args: {
  transport: Exclude<ChatTerminalTransport, { type: "local" }>;
  chatSessionId: string;
  resetSession?: boolean;
  activityLimit: number | "never" | null;
  cols: number;
  rows: number;
}): Record<string, unknown> {
  const { transport, chatSessionId, resetSession, activityLimit, cols, rows } =
    args;
  const activityLimitFields =
    shouldSendBrainActivityLimit(transport) && activityLimit !== null
      ? {
          activityLimitMs: activityLimit === "never" ? null : activityLimit,
        }
      : {};
  if (transport.type === "brain") {
    return {
      target: "brain" as const,
      chatSessionId,
      resetSession,
      ...activityLimitFields,
      cols,
      rows,
    };
  }
  return {
    app: transport.app,
    machineId: transport.machineId,
    feature: transport.feature,
    chatSessionId,
    resetSession,
    ...activityLimitFields,
    cols,
    rows,
  };
}

/** The slice of xterm the engine writes to. */
export interface TerminalWriter {
  cols: number;
  rows: number;
  write(data: string): void;
  writeln(data: string): void;
}

export interface FlyConnectionDeps {
  chatSessionId: string;
  terminalRef: { current: TerminalWriter | null };
  fitAddonRef: { current: { fit(): void } | null };
  transportRef: { current: ChatTerminalTransport };
  disposedRef: { current: boolean };
  sessionEndNotifiedRef: { current: boolean };
  flySocketRef: { current: WebSocket | null };
  flyConnectionStateRef: { current: ChatTerminalConnectionState };
  flyTargetKeyRef: { current: string | null };
  flyConnectSeqRef: { current: number };
  flyConnectInFlightKeyRef: { current: string | null };
  flyConnectFailureKeyRef: { current: string | null };
  flyReconnectTimerRef: { current: number | null };
  flyReconnectNoticeRef: { current: boolean };
  pendingFlyInputAckTimerRef: { current: number | null };
  setFlyConnectionState: (state: ChatTerminalConnectionState) => void;
  notifyConnectionState: (state: ChatTerminalConnectionState) => void;
  setError: (error: string | null) => void;
  setInputSignal: (signal: TerminalInputSignal) => void;
  setInputSignalBriefly: (
    signal: TerminalInputSignal,
    fallback?: TerminalInputSignal,
  ) => void;
  appendCapturedOutput: (data: string) => void;
  notifyTerminalSessionEnded: () => void;
}

export type FlyDepsRef = { current: FlyConnectionDeps };

export function updateFlyConnectionState(
  ref: FlyDepsRef,
  state: ChatTerminalConnectionState,
): void {
  const deps = ref.current;
  deps.flyConnectionStateRef.current = state;
  deps.setFlyConnectionState(state);
  deps.notifyConnectionState(state);
  const signal = inputSignalForConnectionState(state);
  if (state === "closed" || state === "error") {
    if (deps.pendingFlyInputAckTimerRef.current !== null) {
      window.clearTimeout(deps.pendingFlyInputAckTimerRef.current);
      deps.pendingFlyInputAckTimerRef.current = null;
    }
  }
  if (signal) deps.setInputSignal(signal);
}

export function clearScheduledFlyReconnect(ref: FlyDepsRef): void {
  const deps = ref.current;
  if (deps.flyReconnectTimerRef.current !== null) {
    window.clearTimeout(deps.flyReconnectTimerRef.current);
    deps.flyReconnectTimerRef.current = null;
  }
}

export function clearPendingFlyInputAck(ref: FlyDepsRef): void {
  const deps = ref.current;
  if (deps.pendingFlyInputAckTimerRef.current !== null) {
    window.clearTimeout(deps.pendingFlyInputAckTimerRef.current);
    deps.pendingFlyInputAckTimerRef.current = null;
  }
}

export function scheduleFlyReconnect(
  ref: FlyDepsRef,
  reason = "Terminal connection interrupted; reconnecting.",
): void {
  const deps = ref.current;
  if (
    deps.disposedRef.current ||
    !isRemoteTerminalTransport(deps.transportRef.current)
  ) {
    return;
  }
  const ws = deps.flySocketRef.current;
  deps.flySocketRef.current = null;
  clearPendingFlyInputAck(ref);
  deps.setError(null);
  updateFlyConnectionState(ref, "connecting");
  deps.setInputSignal({ tone: "blocked", label: "Reconnecting terminal" });
  if (!deps.flyReconnectNoticeRef.current) {
    deps.terminalRef.current?.writeln(`\r\n\x1b[33m${reason}\x1b[0m`);
    deps.flyReconnectNoticeRef.current = true;
  }
  try {
    ws?.close(4001, reason);
  } catch {}
  clearScheduledFlyReconnect(ref);
  deps.flyReconnectTimerRef.current = window.setTimeout(() => {
    ref.current.flyReconnectTimerRef.current = null;
    ref.current.flyReconnectNoticeRef.current = false;
    void connectFly(ref, { force: true, resetSession: false });
  }, FLY_RECONNECT_DELAY_MS);
}

export function waitForFlyInputAck(ref: FlyDepsRef, inputId: number): number {
  const deps = ref.current;
  clearPendingFlyInputAck(ref);
  deps.setInputSignal({ tone: "queued", label: "Sending input" });
  deps.pendingFlyInputAckTimerRef.current = window.setTimeout(() => {
    const current = ref.current;
    current.pendingFlyInputAckTimerRef.current = null;
    current.setError("Terminal input stalled; reconnecting.");
    current.setInputSignal({ tone: "blocked", label: "Input blocked" });
    const ws = current.flySocketRef.current;
    current.flySocketRef.current = null;
    updateFlyConnectionState(ref, "connecting");
    ws?.close(4000, "terminal input acknowledgement timed out");
    void connectFly(ref, { force: true, resetSession: false });
  }, TERMINAL_INPUT_TIMEOUT_MS);
  return inputId;
}

export function acknowledgeFlyInput(
  ref: FlyDepsRef,
  accepted: boolean,
  message?: string,
): void {
  const deps = ref.current;
  clearPendingFlyInputAck(ref);
  if (accepted) {
    deps.setInputSignalBriefly({ tone: "sent", label: "Input sent" });
    return;
  }
  const text = message ?? "Terminal input was not accepted.";
  deps.setError(text);
  deps.setInputSignal({ tone: "blocked", label: "Input blocked" });
  deps.terminalRef.current?.writeln(`\r\n\x1b[31m${text}\x1b[0m`);
}

export function disconnectFly(ref: FlyDepsRef): void {
  const deps = ref.current;
  if (deps.flySocketRef.current || deps.flyTargetKeyRef.current) {
    deps.notifyTerminalSessionEnded();
  }
  clearScheduledFlyReconnect(ref);
  deps.flyReconnectNoticeRef.current = false;
  deps.flyConnectSeqRef.current += 1;
  deps.flyConnectInFlightKeyRef.current = null;
  deps.flySocketRef.current?.close(1000, "terminal transport changed");
  deps.flySocketRef.current = null;
  deps.flyTargetKeyRef.current = null;
  updateFlyConnectionState(ref, "closed");
}

export async function connectFly(
  ref: FlyDepsRef,
  opts: { force?: boolean; resetSession?: boolean } = {},
): Promise<void> {
  const deps = ref.current;
  const terminal = deps.terminalRef.current;
  const current = deps.transportRef.current;
  if (!terminal || !isRemoteTerminalTransport(current)) return;
  clearScheduledFlyReconnect(ref);

  const key = transportKey(current);
  const attemptKey = `${deps.chatSessionId}:${key}`;
  if (opts.force) {
    deps.flyConnectFailureKeyRef.current = null;
    deps.flyConnectInFlightKeyRef.current = null;
  }
  if (
    shouldSkipFlyConnect({
      force: opts.force ?? false,
      attemptKey,
      failureKey: deps.flyConnectFailureKeyRef.current,
      inFlightKey: deps.flyConnectInFlightKeyRef.current,
      targetKey: deps.flyTargetKeyRef.current,
      connectKey: key,
      existingState: deps.flyConnectionStateRef.current,
    })
  ) {
    return;
  }

  if (deps.flySocketRef.current || deps.flyTargetKeyRef.current) {
    deps.notifyTerminalSessionEnded();
  }
  deps.flySocketRef.current?.close(1000, "reconnecting terminal");
  deps.flySocketRef.current = null;
  deps.flyTargetKeyRef.current = key;
  const seq = deps.flyConnectSeqRef.current + 1;
  deps.flyConnectSeqRef.current = seq;
  deps.flyConnectInFlightKeyRef.current = attemptKey;
  const isCurrentFlyConnect = () =>
    !ref.current.disposedRef.current &&
    ref.current.flyConnectSeqRef.current === seq &&
    ref.current.flyTargetKeyRef.current === key &&
    isRemoteTerminalTransport(ref.current.transportRef.current);
  deps.sessionEndNotifiedRef.current = false;
  updateFlyConnectionState(ref, "connecting");
  deps.setError(null);
  terminal.writeln(
    `\x1b[38;5;245mConnecting to ${
      current.type === "brain"
        ? (current.label ?? "Brain terminal")
        : (current.label ?? current.app)
    }\x1b[0m`,
  );

  try {
    deps.fitAddonRef.current?.fit();
    const requestBody = buildFlySessionRequest({
      transport: current,
      chatSessionId: deps.chatSessionId,
      resetSession: opts.resetSession,
      activityLimit: getStoredBrainTerminalActivityLimit(),
      cols: terminal.cols,
      rows: terminal.rows,
    });
    const res = await fetchWithTimeout(
      "/api/kody/terminal/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(requestBody),
      },
      FLY_CONNECT_TIMEOUT_MS,
    );
    if (!isCurrentFlyConnect()) return;
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
    }
    ref.current.flyConnectFailureKeyRef.current = null;
    const session = (await res.json()) as {
      webSocketUrl: string;
      warnings?: FlySessionWarning[];
    };
    if (!isCurrentFlyConnect()) return;
    for (const notice of brainImageMismatchNotices(session.warnings)) {
      terminal.writeln(notice);
    }
    const ws = new WebSocket(session.webSocketUrl);
    if (!isCurrentFlyConnect()) {
      ws.close(1000, "stale terminal connection");
      return;
    }
    ref.current.flySocketRef.current = ws;

    ws.onopen = () => {
      const live = ref.current;
      if (live.flySocketRef.current !== ws || !isCurrentFlyConnect()) return;
      if (live.terminalRef.current) {
        const message: TerminalBridgeClientMessage = {
          type: "resize",
          cols: live.terminalRef.current.cols,
          rows: live.terminalRef.current.rows,
        };
        ws.send(JSON.stringify(message));
      }
    };
    ws.onmessage = async (event) => {
      const live = ref.current;
      if (live.flySocketRef.current !== ws || !isCurrentFlyConnect()) return;
      const raw =
        typeof event.data === "string"
          ? event.data
          : await (event.data as Blob).text();
      const message = parseTerminalBridgeServerMessage(raw);
      if (!message) {
        live.appendCapturedOutput(raw);
        live.terminalRef.current?.write(raw);
        return;
      }
      if (message.type === "output" && typeof message.data === "string") {
        live.appendCapturedOutput(message.data);
        live.terminalRef.current?.write(message.data);
        return;
      }
      if (message.type === "restore-start") {
        updateFlyConnectionState(ref, "restoring");
        return;
      }
      if (message.type === "restore-complete") {
        updateFlyConnectionState(ref, "connected");
        return;
      }
      if (message.type === "ready") {
        updateFlyConnectionState(ref, "connected");
        return;
      }
      if (message.type === "input-accepted") {
        acknowledgeFlyInput(ref, true);
        return;
      }
      if (message.type === "input-rejected") {
        acknowledgeFlyInput(ref, false, message.message);
        return;
      }
      if (message.type === "error") {
        const text = message.message ?? "Terminal bridge error";
        live.setError(text);
        updateFlyConnectionState(ref, "error");
        live.terminalRef.current?.writeln(`\r\n\x1b[31m${text}\x1b[0m`);
        return;
      }
      if (message.type === "exit") {
        live.notifyTerminalSessionEnded();
        live.flySocketRef.current = null;
        updateFlyConnectionState(ref, "closed");
        live.terminalRef.current?.writeln(
          `\r\nProcess exited${message.code === undefined ? "" : ` (${message.code})`}`,
        );
      }
    };
    ws.onerror = () => {
      const live = ref.current;
      if (live.flySocketRef.current !== ws || !isCurrentFlyConnect()) return;
      scheduleFlyReconnect(ref);
    };
    ws.onclose = (event) => {
      const live = ref.current;
      if (live.flySocketRef.current !== ws || !isCurrentFlyConnect()) return;
      live.flySocketRef.current = null;
      live.notifyTerminalSessionEnded();
      if (
        event.code === 1000 ||
        live.flyConnectionStateRef.current === "error"
      ) {
        updateFlyConnectionState(ref, "closed");
        return;
      }
      scheduleFlyReconnect(ref);
    };
  } catch (err) {
    if (!isCurrentFlyConnect()) return;
    const message =
      err instanceof Error ? err.message : "Failed to connect terminal";
    ref.current.flyConnectFailureKeyRef.current = attemptKey;
    ref.current.setError(message);
    updateFlyConnectionState(ref, "error");
    terminal.writeln(`\x1b[31m${message}\x1b[0m`);
  } finally {
    if (
      ref.current.flyConnectSeqRef.current === seq &&
      ref.current.flyConnectInFlightKeyRef.current === attemptKey
    ) {
      ref.current.flyConnectInFlightKeyRef.current = null;
    }
  }
}
