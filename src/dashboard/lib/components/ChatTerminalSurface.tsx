/**
 * @fileType component
 * @domain terminal
 * @pattern chat-terminal-surface
 *
 * xterm-backed terminal surface for KodyChat Terminal mode.
 */
"use client";

import { ClipboardCopy, Eraser, Loader2, RotateCcw } from "lucide-react";
import {
  forwardRef,
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

interface ChatTerminalSurfaceProps {
  active: boolean;
  chatSessionId: string;
  transport?: ChatTerminalTransport;
  onAddToChat: (context: string) => void;
  onConnectionStateChange?: (state: ChatTerminalConnectionState) => void;
  onSessionEnded?: (snapshot: ChatTerminalSnapshot) => void;
}

export interface ChatTerminalSurfaceHandle {
  sendLine: (line: string) => boolean;
  sendText: (text: string) => boolean;
  executeText: (text: string) => boolean;
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
const FLY_CONNECT_TIMEOUT_MS = 30_000;

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

function transportKey(transport: ChatTerminalTransport): string {
  if (transport.type === "fly")
    return `fly:${transport.app}:${transport.machineId}`;
  return "local";
}

function parseBridgeMessage(
  raw: string,
): { type?: string; data?: string; message?: string; code?: number } | null {
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      data?: string;
      message?: string;
      code?: number;
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

export const ChatTerminalSurface = forwardRef<
  ChatTerminalSurfaceHandle,
  ChatTerminalSurfaceProps
>(function ChatTerminalSurface(
  {
    active,
    chatSessionId,
    transport = { type: "local" },
    onAddToChat,
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
  const localStartFailureKeyRef = useRef<string | null>(null);
  const disposedRef = useRef(false);
  const activeRef = useRef(active);
  const outputCaptureRef = useRef("");
  const sessionEndNotifiedRef = useRef(false);
  const pollBusyRef = useRef(false);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [session, setSession] = useState<TerminalSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      onConnectionStateChange?.(state);
    },
    [onConnectionStateChange],
  );

  const sendResize = useCallback((cols: number, rows: number) => {
    if (transportRef.current.type === "fly") {
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

  const sendRawInput = useCallback((input: string) => {
    if (transportRef.current.type === "fly") {
      const ws = flySocketRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: input }));
      }
      return;
    }
    const current = sessionRef.current;
    if (!current?.alive) return;
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
  }, []);

  const canSendInput = useCallback(() => {
    return transportRef.current.type === "fly"
      ? flySocketRef.current?.readyState === WebSocket.OPEN
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
    onSessionEnded?.(snapshot);
  }, [getTerminalSnapshot, onSessionEnded]);

  useImperativeHandle(
    ref,
    () => ({
      sendLine: (line: string) => sendTerminalText(line),
      sendText: (text: string) => sendTerminalText(text),
      executeText: (text: string) => sendExecutableInput(text),
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
        if (transportRef.current.type === "fly") {
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
      getTerminalSnapshot,
      sendExecutableInput,
      sendTerminalText,
      updateFlyConnectionState,
    ],
  );

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
      onConnectionStateChange?.("connected");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start terminal";
      localStartFailureKeyRef.current = startKey;
      setError(message);
      onConnectionStateChange?.("error");
      terminal.writeln(`\x1b[31m${message}\x1b[0m`);
    } finally {
      setConnecting(false);
    }
  }, [chatSessionId, connecting, onConnectionStateChange]);

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
      if (!terminal || current.type !== "fly") return;

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
      flyTargetKeyRef.current = key;
      const seq = flyConnectSeqRef.current + 1;
      flyConnectSeqRef.current = seq;
      flyConnectInFlightKeyRef.current = attemptKey;
      const isCurrentFlyConnect = () =>
        !disposedRef.current &&
        flyConnectSeqRef.current === seq &&
        flyTargetKeyRef.current === key &&
        transportRef.current.type === "fly";
      sessionEndNotifiedRef.current = false;
      updateFlyConnectionState("connecting");
      setError(null);
      terminal.writeln(
        `\x1b[38;5;245mConnecting to ${current.label ?? current.app}\x1b[0m`,
      );

      try {
        fitAddonRef.current?.fit();
        const activityLimit = getStoredBrainTerminalActivityLimit();
        const shouldSendBrainActivityLimit =
          current.feature === "brain" || current.feature === undefined;
        const res = await fetchWithTimeout(
          "/api/kody/terminal/session",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
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
            }),
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
        const session = (await res.json()) as { webSocketUrl: string };
        if (!isCurrentFlyConnect()) return;
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
      appendCapturedOutput,
      chatSessionId,
      notifyTerminalSessionEnded,
      updateFlyConnectionState,
    ],
  );

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
        onConnectionStateChange?.("closed");
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
    onConnectionStateChange,
  ]);

  useEffect(() => {
    if (!ready || !active) return;
    fitAddonRef.current?.fit();
    if (transport.type === "fly") {
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
    transport.type,
  ]);

  useEffect(() => {
    if (!active || !session?.sessionId || transport.type !== "local")
      return;
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
      onConnectionStateChange?.("closed");
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
    [notifyTerminalSessionEnded, onConnectionStateChange],
  );
  useEffect(() => {
    stopRef.current = () => stop();
  }, [stop]);

  useEffect(() => {
    if (transport.type === "fly") {
      void stop(false);
    }
  }, [currentTransportKey, stop, transport.type]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      flyConnectSeqRef.current += 1;
      flyConnectInFlightKeyRef.current = null;
      flySocketRef.current?.close(1000, "terminal unmounted");
    };
  }, []);

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
    if (transportRef.current.type === "fly") {
      void connectFly({ force: true, resetSession: true });
      return;
    }
    localStartFailureKeyRef.current = null;
    void stop().then(() => start());
  }, [connectFly, start, stop]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#050608]">
      <div className="flex items-center gap-1 border-b border-white/10 bg-black/30 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
          {transport.type === "fly"
            ? (error ??
              `${transport.label ?? transport.app} · ${flyConnectionState}`)
            : (error ??
              (session?.alive ? session.cwd : connecting ? "starting" : "closed"))}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={addToChat}
            className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-300 hover:bg-white/10 hover:text-white"
            title="Add terminal output to AI chat"
            aria-label="Add terminal output to AI chat"
          >
            <ClipboardCopy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={restart}
            disabled={connecting || flyConnectionState === "connecting"}
            className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Restart terminal"
            aria-label="Restart terminal"
          >
            {connecting || flyConnectionState === "connecting" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-300 hover:bg-white/10 hover:text-white"
            title="Clear terminal"
            aria-label="Clear terminal"
          >
            <Eraser className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />
      </div>
    </div>
  );
});
