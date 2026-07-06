/**
 * @fileType component
 * @domain terminal
 * @pattern chat-terminal-surface
 *
 * xterm-backed terminal surface for KodyChat Terminal mode.
 */
"use client";

import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import { toast } from "sonner";

import { getStoredBrainTerminalActivityLimit } from "../api";
import { authHeaders } from "./kody-chat-live-session";

interface TerminalSessionState {
  sessionId: string;
  cwd: string;
  shell: string;
  cursor: number;
  alive: boolean;
}

export type ChatTerminalTransport =
  | { type: "local"; label?: string }
  | { type: "brain"; label?: string }
  | {
      type: "fly";
      app: string;
      machineId: string;
      label?: string;
      feature?: "runner" | "brain";
    };

export type ChatTerminalConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export interface ChatTerminalSnapshot {
  cwd?: string;
  shell?: string;
  output: string;
}

type TerminalOutputEvent =
  | {
      id: number;
      type: "output";
      data: string;
      at: string;
    }
  | {
      id: number;
      type: "exit";
      code?: number;
      signal?: number;
      at: string;
    };

type TerminalInputSignal = {
  tone: "idle" | "ready" | "sent" | "queued" | "blocked";
  label: string;
};

export interface ChatTerminalChromeState {
  statusText: string;
  inputLabel: string;
  inputTone: TerminalInputSignal["tone"];
  actionBusy: boolean;
}

interface ChatTerminalSurfaceProps {
  active: boolean;
  chatSessionId: string;
  transport?: ChatTerminalTransport;
  topToolbar?: ReactNode;
  onAddToChat: (context: string) => void;
  onChromeStateChange?: (state: ChatTerminalChromeState) => void;
  onConnectionStateChange?: (state: ChatTerminalConnectionState) => void;
  onSessionEnded?: (snapshot: ChatTerminalSnapshot) => void;
}

export interface ChatTerminalSurfaceHandle {
  sendLine: (line: string) => boolean;
  sendText: (text: string) => boolean;
  executeText: (text: string) => boolean;
  addToChat: () => void;
  clear: () => void;
  restart: () => void;
  stop: () => Promise<void>;
  focus: () => void;
  getSnapshot: () => ChatTerminalSnapshot;
  restoreSnapshot: (snapshot: { name: string; output?: string }) => void;
}

const MAX_CAPTURE_CHARS = 16_000;
const MAX_CAPTURE_LINES = 160;
const TERMINAL_RESIZE_TIMEOUT_MS = 3_000;
const TERMINAL_INPUT_TIMEOUT_MS = 8_000;
const TERMINAL_STOP_TIMEOUT_MS = 8_000;
const LOCAL_POLL_TIMEOUT_MS = 5_000;
const TERMINAL_START_TIMEOUT_MS = 20_000;
const FLY_CONNECT_TIMEOUT_MS = 75_000;
const MAX_PENDING_INPUT_CHARS = 8_000;

function fetchWithTimeout(
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

function isRemoteTerminalTransport(
  transport: ChatTerminalTransport,
): transport is Exclude<ChatTerminalTransport, { type: "local" }> {
  return transport.type === "fly" || transport.type === "brain";
}

function transportKey(transport: ChatTerminalTransport): string {
  if (transport.type === "brain") return "brain";
  if (transport.type === "fly")
    return `fly:${transport.app}:${transport.machineId}`;
  return "local";
}

function parseBridgeMessage(
  raw: string,
): {
  type?: string;
  data?: string;
  message?: string;
  code?: number;
  id?: number;
} | null {
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      data?: string;
      message?: string;
      code?: number;
      id?: number;
    };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function stripTerminalSequences(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "");
}

function cleanTerminalText(value: string): string {
  const stripped = stripTerminalSequences(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  let output = "";
  for (const char of stripped) {
    if (char === "\b" || char === "\x7f") {
      output = output.slice(0, -1);
      continue;
    }
    if (char === "\n" || char === "\t" || char >= " ") {
      output += char;
    }
  }
  return output;
}

function usefulCapturedOutput(value: string): string {
  const lines = cleanTerminalText(value)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const tail = lines.slice(-MAX_CAPTURE_LINES).join("\n").trim();
  return tail.length > MAX_CAPTURE_CHARS
    ? tail.slice(tail.length - MAX_CAPTURE_CHARS).trimStart()
    : tail;
}

function shortBrainImageLabel(imageRef?: string | null): string {
  if (!imageRef) return "none";
  const tag = imageRef.split(":").pop();
  if (tag && tag !== imageRef) return tag;
  return imageRef.split("/").pop() ?? imageRef;
}

export const ChatTerminalSurface = forwardRef<
  ChatTerminalSurfaceHandle,
  ChatTerminalSurfaceProps
>(function ChatTerminalSurface(
  {
    active,
    chatSessionId,
    transport = { type: "local" },
    topToolbar,
    onAddToChat,
    onChromeStateChange,
    onConnectionStateChange,
    onSessionEnded,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<XTermFitAddon | null>(null);
  const sessionRef = useRef<TerminalSessionState | null>(null);
  const transportRef = useRef<ChatTerminalTransport>(transport);
  const flySocketRef = useRef<WebSocket | null>(null);
  const flyConnectionStateRef = useRef<ChatTerminalConnectionState>("idle");
  const flyTargetKeyRef = useRef<string | null>(null);
  const flyConnectSeqRef = useRef(0);
  const flyConnectInFlightKeyRef = useRef<string | null>(null);
  const flyConnectFailureKeyRef = useRef<string | null>(null);
  const nextFlyInputIdRef = useRef(1);
  const pendingFlyInputAckTimerRef = useRef<number | null>(null);
  const localStartFailureKeyRef = useRef<string | null>(null);
  const disposedRef = useRef(false);
  const activeRef = useRef(active);
  const outputCaptureRef = useRef("");
  const pendingFlyInputRef = useRef("");
  const inputSignalTimerRef = useRef<number | null>(null);
  const sessionEndNotifiedRef = useRef(false);
  const pollBusyRef = useRef(false);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const reconnectFlyRef = useRef<
    (opts?: { force?: boolean; resetSession?: boolean }) => void
  >(() => {});
  const onConnectionStateChangeRef = useRef(onConnectionStateChange);
  const onSessionEndedRef = useRef(onSessionEnded);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [session, setSession] = useState<TerminalSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputSignal, setInputSignal] = useState<TerminalInputSignal>({
    tone: "idle",
    label: "No input",
  });
  const [flyConnectionState, setFlyConnectionState] =
    useState<ChatTerminalConnectionState>("idle");

  const currentTransportKey = transportKey(transport);

  useEffect(() => {
    localStartFailureKeyRef.current = null;
    flyConnectFailureKeyRef.current = null;
  }, [chatSessionId, currentTransportKey]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  useEffect(() => {
    onConnectionStateChangeRef.current = onConnectionStateChange;
  }, [onConnectionStateChange]);

  useEffect(() => {
    onSessionEndedRef.current = onSessionEnded;
  }, [onSessionEnded]);

  const notifyConnectionState = useCallback(
    (state: ChatTerminalConnectionState) => {
      onConnectionStateChangeRef.current?.(state);
    },
    [],
  );

  const appendCapturedOutput = useCallback((data: string) => {
    const cleaned = cleanTerminalText(data);
    if (!cleaned) return;
    outputCaptureRef.current = `${outputCaptureRef.current}${cleaned}`.slice(
      -MAX_CAPTURE_CHARS * 2,
    );
  }, []);

  const updateFlyConnectionState = useCallback(
    (state: ChatTerminalConnectionState) => {
      flyConnectionStateRef.current = state;
      setFlyConnectionState(state);
      notifyConnectionState(state);
      if (state === "connected") {
        setInputSignal({ tone: "ready", label: "Ready for input" });
      } else if (state === "connecting") {
        setInputSignal({ tone: "blocked", label: "Waiting for terminal" });
      } else if (state === "closed" || state === "error") {
        pendingFlyInputRef.current = "";
        if (pendingFlyInputAckTimerRef.current !== null) {
          window.clearTimeout(pendingFlyInputAckTimerRef.current);
          pendingFlyInputAckTimerRef.current = null;
        }
        setInputSignal({ tone: "blocked", label: "Input blocked" });
      }
    },
    [notifyConnectionState],
  );

  const setInputSignalBriefly = useCallback(
    (signal: TerminalInputSignal, fallback?: TerminalInputSignal) => {
      if (inputSignalTimerRef.current !== null) {
        window.clearTimeout(inputSignalTimerRef.current);
      }
      setInputSignal(signal);
      inputSignalTimerRef.current = window.setTimeout(() => {
        setInputSignal(
          fallback ??
            (isRemoteTerminalTransport(transportRef.current)
              ? flyConnectionStateRef.current === "connected"
                ? { tone: "ready", label: "Ready for input" }
                : { tone: "blocked", label: "Waiting for terminal" }
              : sessionRef.current?.alive
                ? { tone: "ready", label: "Ready for input" }
                : { tone: "blocked", label: "Input blocked" }),
        );
        inputSignalTimerRef.current = null;
      }, 1400);
    },
    [],
  );

  const clearPendingFlyInputAck = useCallback(() => {
    if (pendingFlyInputAckTimerRef.current !== null) {
      window.clearTimeout(pendingFlyInputAckTimerRef.current);
      pendingFlyInputAckTimerRef.current = null;
    }
  }, []);

  const waitForFlyInputAck = useCallback(
    (inputId: number) => {
      clearPendingFlyInputAck();
      setInputSignal({ tone: "queued", label: "Sending input" });
      pendingFlyInputAckTimerRef.current = window.setTimeout(() => {
        pendingFlyInputAckTimerRef.current = null;
        setError("Terminal input stalled; reconnecting.");
        setInputSignal({ tone: "blocked", label: "Input blocked" });
        const ws = flySocketRef.current;
        flySocketRef.current = null;
        updateFlyConnectionState("connecting");
        ws?.close(4000, "terminal input acknowledgement timed out");
        reconnectFlyRef.current({ force: true, resetSession: false });
      }, TERMINAL_INPUT_TIMEOUT_MS);
      return inputId;
    },
    [clearPendingFlyInputAck, updateFlyConnectionState],
  );

  const acknowledgeFlyInput = useCallback(
    (accepted: boolean, message?: string) => {
      clearPendingFlyInputAck();
      if (accepted) {
        setInputSignalBriefly({ tone: "sent", label: "Input sent" });
        return;
      }
      const text = message ?? "Terminal input was not accepted.";
      setError(text);
      setInputSignal({ tone: "blocked", label: "Input blocked" });
      terminalRef.current?.writeln(`\r\n\x1b[31m${text}\x1b[0m`);
    },
    [clearPendingFlyInputAck, setInputSignalBriefly],
  );

  const flushPendingFlyInput = useCallback(() => {
    const queuedInput = pendingFlyInputRef.current;
    if (!queuedInput) return;
    const ws = flySocketRef.current;
    if (
      ws?.readyState !== WebSocket.OPEN ||
      flyConnectionStateRef.current !== "connected"
    ) {
      return;
    }
    pendingFlyInputRef.current = "";
    ws.send(JSON.stringify({ type: "input", data: queuedInput }));
    setInputSignalBriefly({ tone: "sent", label: "Queued input sent" });
  }, [setInputSignalBriefly]);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (isRemoteTerminalTransport(transportRef.current)) {
      const ws = flySocketRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
      return;
    }
    const current = sessionRef.current;
    if (!current?.alive) return;
    void fetchWithTimeout(
      "/api/kody/chat/terminal/resize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sessionId: current.sessionId, cols, rows }),
      },
      TERMINAL_RESIZE_TIMEOUT_MS,
    ).catch(() => {});
  }, []);

  const sendRawInput = useCallback(
    (input: string) => {
      if (isRemoteTerminalTransport(transportRef.current)) {
        const ws = flySocketRef.current;
        if (
          ws?.readyState === WebSocket.OPEN &&
          flyConnectionStateRef.current === "connected"
        ) {
          const inputId = nextFlyInputIdRef.current;
          nextFlyInputIdRef.current += 1;
          ws.send(JSON.stringify({ type: "input", id: inputId, data: input }));
          waitForFlyInputAck(inputId);
        } else if (
          ws?.readyState === WebSocket.OPEN ||
          flyConnectionStateRef.current === "connecting"
        ) {
          pendingFlyInputRef.current =
            `${pendingFlyInputRef.current}${input}`.slice(
              -MAX_PENDING_INPUT_CHARS,
            );
          setInputSignalBriefly(
            { tone: "queued", label: "Input queued" },
            { tone: "blocked", label: "Waiting for terminal" },
          );
        } else {
          setInputSignalBriefly({
            tone: "blocked",
            label: "Input blocked",
          });
        }
        return;
      }
      const current = sessionRef.current;
      if (!current?.alive) {
        setInputSignalBriefly({ tone: "blocked", label: "Input blocked" });
        return;
      }
      setInputSignalBriefly({ tone: "sent", label: "Input sent" });
      void fetchWithTimeout(
        "/api/kody/chat/terminal/input",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            sessionId: current.sessionId,
            input,
            raw: true,
          }),
        },
        TERMINAL_INPUT_TIMEOUT_MS,
      ).catch(() => {});
    },
    [setInputSignalBriefly, waitForFlyInputAck],
  );

  const canSendInput = useCallback(() => {
    return isRemoteTerminalTransport(transportRef.current)
      ? flySocketRef.current?.readyState === WebSocket.OPEN ||
          flyConnectionStateRef.current === "connecting"
      : !!sessionRef.current?.alive;
  }, []);

  const sendTerminalText = useCallback(
    (text: string) => {
      const normalizedInput = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n/g, "\r");
      if (!normalizedInput.trim() || !canSendInput()) return false;
      if (normalizedInput.endsWith("\r")) {
        sendRawInput(normalizedInput);
      } else {
        sendRawInput(`${normalizedInput}\r`);
      }
      return true;
    },
    [canSendInput, sendRawInput],
  );

  const sendExecutableInput = useCallback(
    (text: string) => {
      const normalizedInput = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!normalizedInput.trim() || !canSendInput()) return false;
      const executableInput = normalizedInput.endsWith("\n")
        ? normalizedInput
        : `${normalizedInput}\n`;

      if (transportRef.current.type === "local") {
        const current = sessionRef.current;
        if (!current?.alive) return false;
        void fetchWithTimeout(
          "/api/kody/chat/terminal/input",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              sessionId: current.sessionId,
              input: executableInput,
              raw: false,
            }),
          },
          TERMINAL_INPUT_TIMEOUT_MS,
        ).catch(() => {});
        return true;
      }

      sendRawInput(executableInput.replace(/\n/g, "\r"));
      return true;
    },
    [canSendInput, sendRawInput],
  );

  const getTerminalSnapshot = useCallback(
    (): ChatTerminalSnapshot => ({
      cwd: sessionRef.current?.cwd,
      shell: sessionRef.current?.shell,
      output: usefulCapturedOutput(outputCaptureRef.current),
    }),
    [],
  );

  const notifyTerminalSessionEnded = useCallback(() => {
    if (sessionEndNotifiedRef.current) return;
    sessionEndNotifiedRef.current = true;
    const snapshot = getTerminalSnapshot();
    if (!snapshot.output.trim()) return;
    onSessionEndedRef.current?.(snapshot);
  }, [getTerminalSnapshot]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;
    const disposables: Array<{ dispose: () => void }> = [];

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily:
          "'SFMono-Regular', 'Cascadia Code', 'Liberation Mono', Menlo, monospace",
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 10000,
        theme: {
          background: "#050608",
          foreground: "#d7dde8",
          cursor: "#ffffff",
          black: "#0a0d12",
          blue: "#7aa2f7",
          cyan: "#7dcfff",
          green: "#9ece6a",
          magenta: "#bb9af7",
          red: "#f7768e",
          white: "#c0caf5",
          yellow: "#e0af68",
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(host);
      fitAddon.fit();

      disposables.push(terminal.onData(sendRawInput));
      disposables.push(
        terminal.onResize(({ cols, rows }) => sendResize(cols, rows)),
      );

      observer = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (!activeRef.current) return;
          fitAddon.fit();
          sendResize(terminal.cols, terminal.rows);
        });
      });
      observer.observe(host);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      setReady(true);
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      for (const disposable of disposables) disposable.dispose();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sendRawInput, sendResize]);

  const start = useCallback(async () => {
    const terminal = terminalRef.current;
    if (transportRef.current.type !== "local") return;
    if (!terminal || connecting || sessionRef.current?.alive) return;

    const currentTransport = transportRef.current;
    const startKey = `${currentTransport.type}:${chatSessionId}:${transportKey(currentTransport)}`;
    if (localStartFailureKeyRef.current === startKey) return;

    setConnecting(true);
    setError(null);
    setInputSignal({ tone: "blocked", label: "Waiting for terminal" });
    try {
      fitAddonRef.current?.fit();
      const res = await fetchWithTimeout(
        "/api/kody/chat/terminal/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            chatSessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        },
        TERMINAL_START_TIMEOUT_MS,
      );
      const data = (await res.json().catch(() => ({}))) as {
        session?: TerminalSessionState;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.session) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      localStartFailureKeyRef.current = null;
      sessionEndNotifiedRef.current = false;
      sessionRef.current = data.session;
      setSession(data.session);
      notifyConnectionState("connected");
      setInputSignal({ tone: "ready", label: "Ready for input" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start terminal";
      localStartFailureKeyRef.current = startKey;
      setError(message);
      setInputSignal({ tone: "blocked", label: "Input blocked" });
      notifyConnectionState("error");
      terminal.writeln(`\x1b[31m${message}\x1b[0m`);
    } finally {
      setConnecting(false);
    }
  }, [chatSessionId, connecting, notifyConnectionState]);

  const disconnectFly = useCallback(() => {
    if (flySocketRef.current || flyTargetKeyRef.current) {
      notifyTerminalSessionEnded();
    }
    flyConnectSeqRef.current += 1;
    flyConnectInFlightKeyRef.current = null;
    flySocketRef.current?.close(1000, "terminal transport changed");
    flySocketRef.current = null;
    flyTargetKeyRef.current = null;
    updateFlyConnectionState("closed");
  }, [notifyTerminalSessionEnded, updateFlyConnectionState]);

  const connectFly = useCallback(
    async (opts: { force?: boolean; resetSession?: boolean } = {}) => {
      const terminal = terminalRef.current;
      const current = transportRef.current;
      if (!terminal || !isRemoteTerminalTransport(current)) return;

      const key = transportKey(current);
      const existingState = flyConnectionStateRef.current;
      const attemptKey = `${chatSessionId}:${key}`;
      if (opts.force) {
        flyConnectFailureKeyRef.current = null;
        flyConnectInFlightKeyRef.current = null;
      } else if (flyConnectFailureKeyRef.current === attemptKey) {
        return;
      } else if (flyConnectInFlightKeyRef.current === attemptKey) {
        return;
      }
      if (
        !opts.force &&
        flyTargetKeyRef.current === key &&
        (existingState === "connecting" || existingState === "connected")
      ) {
        return;
      }

      if (flySocketRef.current || flyTargetKeyRef.current) {
        notifyTerminalSessionEnded();
      }
      flySocketRef.current?.close(1000, "reconnecting terminal");
      flySocketRef.current = null;
      pendingFlyInputRef.current = "";
      flyTargetKeyRef.current = key;
      const seq = flyConnectSeqRef.current + 1;
      flyConnectSeqRef.current = seq;
      flyConnectInFlightKeyRef.current = attemptKey;
      const isCurrentFlyConnect = () =>
        !disposedRef.current &&
        flyConnectSeqRef.current === seq &&
        flyTargetKeyRef.current === key &&
        isRemoteTerminalTransport(transportRef.current);
      sessionEndNotifiedRef.current = false;
      updateFlyConnectionState("connecting");
      setError(null);
      terminal.writeln(
        `\x1b[38;5;245mConnecting to ${
          current.type === "brain"
            ? (current.label ?? "Brain terminal")
            : (current.label ?? current.app)
        }\x1b[0m`,
      );

      try {
        fitAddonRef.current?.fit();
        const activityLimit = getStoredBrainTerminalActivityLimit();
        const shouldSendBrainActivityLimit =
          current.type === "brain" ||
          (current.type === "fly" &&
            (current.feature === "brain" || current.feature === undefined));
        const requestBody =
          current.type === "brain"
            ? {
                target: "brain" as const,
                chatSessionId,
                resetSession: opts.resetSession,
                ...(shouldSendBrainActivityLimit && activityLimit !== null
                  ? {
                      activityLimitMs:
                        activityLimit === "never" ? null : activityLimit,
                    }
                  : {}),
                cols: terminal.cols,
                rows: terminal.rows,
              }
            : {
                app: current.app,
                machineId: current.machineId,
                feature: current.feature,
                chatSessionId,
                resetSession: opts.resetSession,
                ...(shouldSendBrainActivityLimit && activityLimit !== null
                  ? {
                      activityLimitMs:
                        activityLimit === "never" ? null : activityLimit,
                    }
                  : {}),
                cols: terminal.cols,
                rows: terminal.rows,
              };
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
        flyConnectFailureKeyRef.current = null;
        const session = (await res.json()) as {
          webSocketUrl: string;
          warnings?: Array<{
            code?: string;
            message?: string;
            desiredImageRef?: string;
            runningImageRef?: string | null;
          }>;
        };
        if (!isCurrentFlyConnect()) return;
        for (const warning of session.warnings ?? []) {
          if (
            warning.code === "selected_image_not_running" &&
            warning.desiredImageRef
          ) {
            const selectedLabel = shortBrainImageLabel(
              warning.desiredImageRef,
            );
            const runningLabel = shortBrainImageLabel(
              warning.runningImageRef,
            );
            terminal.writeln(
              `\x1b[33mSelected image differs from running Brain. Selected: ${selectedLabel}; running: ${runningLabel}. Terminal is connecting to the running Brain.\x1b[0m`,
            );
          }
        }
        const ws = new WebSocket(session.webSocketUrl);
        if (!isCurrentFlyConnect()) {
          ws.close(1000, "stale terminal connection");
          return;
        }
        flySocketRef.current = ws;

        ws.onopen = () => {
          if (flySocketRef.current !== ws || !isCurrentFlyConnect()) return;
          if (terminalRef.current) {
            ws.send(
              JSON.stringify({
                type: "resize",
                cols: terminalRef.current.cols,
                rows: terminalRef.current.rows,
              }),
            );
          }
        };
        ws.onmessage = async (event) => {
          if (flySocketRef.current !== ws || !isCurrentFlyConnect()) return;
          const raw =
            typeof event.data === "string"
              ? event.data
              : await (event.data as Blob).text();
          const message = parseBridgeMessage(raw);
          if (!message) {
            appendCapturedOutput(raw);
            terminalRef.current?.write(raw);
            return;
          }
          if (message.type === "output" && typeof message.data === "string") {
            appendCapturedOutput(message.data);
            terminalRef.current?.write(message.data);
            return;
          }
          if (message.type === "ready") {
            updateFlyConnectionState("connected");
            flushPendingFlyInput();
            return;
          }
          if (message.type === "input-accepted") {
            acknowledgeFlyInput(true);
            return;
          }
          if (message.type === "input-rejected") {
            acknowledgeFlyInput(false, message.message);
            return;
          }
          if (message.type === "error") {
            const text = message.message ?? "Terminal bridge error";
            setError(text);
            updateFlyConnectionState("error");
            terminalRef.current?.writeln(`\r\n\x1b[31m${text}\x1b[0m`);
            return;
          }
          if (message.type === "exit") {
            notifyTerminalSessionEnded();
            updateFlyConnectionState("closed");
            terminalRef.current?.writeln(
              `\r\nProcess exited${message.code === undefined ? "" : ` (${message.code})`}`,
            );
          }
        };
        ws.onerror = () => {
          if (flySocketRef.current !== ws || !isCurrentFlyConnect()) return;
          setError("Terminal websocket error.");
          updateFlyConnectionState("error");
          terminalRef.current?.writeln(
            "\r\n\x1b[31mTerminal websocket error\x1b[0m",
          );
        };
        ws.onclose = () => {
          if (flySocketRef.current !== ws || !isCurrentFlyConnect()) return;
          flySocketRef.current = null;
          notifyTerminalSessionEnded();
          if (flyConnectionStateRef.current !== "error") {
            updateFlyConnectionState("closed");
          }
        };
      } catch (err) {
        if (!isCurrentFlyConnect()) return;
        const message =
          err instanceof Error ? err.message : "Failed to connect terminal";
        flyConnectFailureKeyRef.current = attemptKey;
        setError(message);
        updateFlyConnectionState("error");
        terminal.writeln(`\x1b[31m${message}\x1b[0m`);
      } finally {
        if (
          flyConnectSeqRef.current === seq &&
          flyConnectInFlightKeyRef.current === attemptKey
        ) {
          flyConnectInFlightKeyRef.current = null;
        }
      }
    },
    [
      acknowledgeFlyInput,
      appendCapturedOutput,
      chatSessionId,
      flushPendingFlyInput,
      notifyTerminalSessionEnded,
      updateFlyConnectionState,
    ],
  );

  useEffect(() => {
    reconnectFlyRef.current = (opts) => {
      void connectFly(opts);
    };
  }, [connectFly]);

  const pollOutput = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || pollBusyRef.current) return;

    pollBusyRef.current = true;
    try {
      const params = new URLSearchParams({
        sessionId: current.sessionId,
        cursor: String(current.cursor),
      });
      const res = await fetchWithTimeout(
        `/api/kody/chat/terminal/output?${params}`,
        { headers: authHeaders() },
        LOCAL_POLL_TIMEOUT_MS,
      );
      const data = (await res.json().catch(() => ({}))) as {
        events?: TerminalOutputEvent[];
        cursor?: number;
        alive?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setError(null);

      const nextSession = {
        ...current,
        cursor: data.cursor ?? current.cursor,
        alive: data.alive ?? current.alive,
      };
      sessionRef.current = nextSession;
      setSession(nextSession);

      for (const event of data.events ?? []) {
        if (event.type === "output") {
          appendCapturedOutput(event.data);
          terminalRef.current?.write(event.data);
          continue;
        }
        terminalRef.current?.writeln(
          `\r\nProcess exited${event.code === undefined ? "" : ` (${event.code})`}`,
        );
        sessionRef.current = { ...nextSession, alive: false };
        notifyConnectionState("closed");
        notifyTerminalSessionEnded();
        setSession((existing) =>
          existing ? { ...existing, alive: false } : existing,
        );
      }
      if (current.alive && data.alive === false) {
        notifyTerminalSessionEnded();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Terminal output stalled; retrying.");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    } finally {
      pollBusyRef.current = false;
    }
  }, [
    appendCapturedOutput,
    notifyTerminalSessionEnded,
    notifyConnectionState,
  ]);

  useEffect(() => {
    if (!ready || !active) return;
    fitAddonRef.current?.fit();
    if (isRemoteTerminalTransport(transport)) {
      void connectFly();
      return;
    }
    disconnectFly();
    void start();
  }, [
    active,
    connectFly,
    currentTransportKey,
    disconnectFly,
    ready,
    start,
    transport,
  ]);

  useEffect(() => {
    if (!active || !session?.sessionId || transport.type !== "local") return;
    const interval = setInterval(() => void pollOutput(), 200);
    void pollOutput();
    return () => clearInterval(interval);
  }, [
    active,
    currentTransportKey,
    pollOutput,
    session?.sessionId,
    transport.type,
  ]);

  const stop = useCallback(
    async (announce = true) => {
      const current = sessionRef.current;
      if (!current) return;
      notifyTerminalSessionEnded();
      sessionRef.current = null;
      setSession(null);
      setInputSignal({ tone: "blocked", label: "Input blocked" });
      notifyConnectionState("closed");
      await fetchWithTimeout(
        "/api/kody/chat/terminal/stop",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ sessionId: current.sessionId }),
        },
        TERMINAL_STOP_TIMEOUT_MS,
      ).catch(() => {});
      if (announce) terminalRef.current?.writeln("\r\nTerminal stopped");
    },
    [notifyConnectionState, notifyTerminalSessionEnded],
  );
  useEffect(() => {
    stopRef.current = () => stop();
  }, [stop]);

  useEffect(() => {
    if (isRemoteTerminalTransport(transport)) {
      void stop(false);
    }
  }, [currentTransportKey, stop, transport]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (inputSignalTimerRef.current !== null) {
        window.clearTimeout(inputSignalTimerRef.current);
        inputSignalTimerRef.current = null;
      }
      clearPendingFlyInputAck();
      flyConnectSeqRef.current += 1;
      flyConnectInFlightKeyRef.current = null;
      flySocketRef.current?.close(1000, "terminal unmounted");
    };
  }, [clearPendingFlyInputAck]);

  const addToChat = useCallback(() => {
    const text = usefulCapturedOutput(outputCaptureRef.current);
    if (!text.trim()) {
      toast.info("No terminal output to add yet");
      return;
    }
    onAddToChat(`## Terminal output\n\n\`\`\`\`text\n${text}\n\`\`\`\``);
  }, [onAddToChat]);

  const clear = useCallback(() => {
    outputCaptureRef.current = "";
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, []);

  const restart = useCallback(() => {
    pendingFlyInputRef.current = "";
    setInputSignal({ tone: "blocked", label: "Waiting for terminal" });
    if (isRemoteTerminalTransport(transportRef.current)) {
      void connectFly({ force: true, resetSession: true });
      return;
    }
    localStartFailureKeyRef.current = null;
    void stop().then(() => start());
  }, [connectFly, start, stop]);

  useImperativeHandle(
    ref,
    () => ({
      sendLine: (line: string) => sendTerminalText(line),
      sendText: (text: string) => sendTerminalText(text),
      executeText: (text: string) => sendExecutableInput(text),
      addToChat,
      clear,
      restart,
      stop: () => stopRef.current(),
      focus: () => {
        terminalRef.current?.focus();
      },
      getSnapshot: getTerminalSnapshot,
      restoreSnapshot: (snapshot) => {
        const terminal = terminalRef.current;
        if (!terminal) return;
        const text = usefulCapturedOutput(snapshot.output ?? "");
        setError(null);
        if (isRemoteTerminalTransport(transportRef.current)) {
          updateFlyConnectionState("closed");
        }
        outputCaptureRef.current = text;
        terminal.clear();
        terminal.writeln(
          `\x1b[38;5;245m## Restored terminal snapshot: ${snapshot.name}\x1b[0m`,
        );
        if (text) {
          terminal.write(`${text.replace(/\n/g, "\r\n")}\r\n`);
        }
        terminal.focus();
      },
    }),
    [
      addToChat,
      clear,
      getTerminalSnapshot,
      restart,
      sendExecutableInput,
      sendTerminalText,
      updateFlyConnectionState,
    ],
  );

  const statusText =
    isRemoteTerminalTransport(transport)
      ? (error ??
        `${
          transport.type === "brain"
            ? (transport.label ?? "Brain terminal")
            : (transport.label ?? transport.app)
        } · ${flyConnectionState}`)
      : (error ??
        (session?.alive ? session.cwd : connecting ? "starting" : "closed"));
  const actionBusy = connecting || flyConnectionState === "connecting";

  useEffect(() => {
    onChromeStateChange?.({
      statusText,
      inputLabel: inputSignal.label,
      inputTone: inputSignal.tone,
      actionBusy,
    });
  }, [
    actionBusy,
    inputSignal.label,
    inputSignal.tone,
    onChromeStateChange,
    statusText,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#050608]">
      {topToolbar && (
        <div className="flex min-h-12 items-center border-b border-white/10 bg-black/30 px-2 py-1.5">
          {topToolbar}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />
      </div>
    </div>
  );
});
