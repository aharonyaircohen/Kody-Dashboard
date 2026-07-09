/**
 * @fileType component
 * @domain chat-plugin-terminal
 * @pattern chat-terminal-surface
 *
 * xterm-backed terminal surface for KodyChat Terminal mode. The remote
 * (Fly/Brain) connection engine lives in fly-connection.ts; pure text
 * helpers in terminal-text.ts (Step 5a split — the component keeps the
 * xterm lifecycle, the local pty session, and input routing).
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

import { authHeaders } from "../../core/kody-chat-live-session";
import {
  connectFly,
  disconnectFly,
  clearPendingFlyInputAck,
  clearScheduledFlyReconnect,
  fetchWithTimeout,
  isRemoteTerminalTransport,
  scheduleFlyReconnect,
  transportKey,
  updateFlyConnectionState,
  waitForFlyInputAck,
  LOCAL_OUTPUT_READ_TIMEOUT_MS,
  LOCAL_OUTPUT_WAIT_MS,
  TERMINAL_INPUT_TIMEOUT_MS,
  TERMINAL_RESIZE_TIMEOUT_MS,
  TERMINAL_START_TIMEOUT_MS,
  TERMINAL_STOP_TIMEOUT_MS,
  type FlyConnectionDeps,
} from "./fly-connection";
import {
  cleanTerminalText,
  MAX_CAPTURE_CHARS,
  usefulCapturedOutput,
} from "./terminal-text";
import { mountChatTerminal } from "./xterm-setup";
import type {
  ChatTerminalChromeState,
  ChatTerminalConnectionState,
  ChatTerminalSnapshot,
  ChatTerminalTransport,
  TerminalInputSignal,
} from "./types";

export type {
  ChatTerminalChromeState,
  ChatTerminalConnectionState,
  ChatTerminalSnapshot,
  ChatTerminalTransport,
} from "./types";

interface TerminalSessionState {
  sessionId: string;
  cwd: string;
  shell: string;
  cursor: number;
  alive: boolean;
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
  const flyReconnectTimerRef = useRef<number | null>(null);
  const flyReconnectNoticeRef = useRef(false);
  const nextFlyInputIdRef = useRef(1);
  const pendingFlyInputAckTimerRef = useRef<number | null>(null);
  const terminalSelectionClearTimerRef = useRef<number | null>(null);
  const localStartFailureKeyRef = useRef<string | null>(null);
  const disposedRef = useRef(false);
  const activeRef = useRef(active);
  const outputCaptureRef = useRef("");
  const inputSignalTimerRef = useRef<number | null>(null);
  const sessionEndNotifiedRef = useRef(false);
  const pollBusyRef = useRef(false);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const onConnectionStateChangeRef = useRef(onConnectionStateChange);
  const onSessionEndedRef = useRef(onSessionEnded);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [session, setSession] = useState<TerminalSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTerminalText, setSelectedTerminalText] = useState("");
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

  const clearScheduledTerminalSelection = useCallback(() => {
    if (terminalSelectionClearTimerRef.current !== null) {
      window.clearTimeout(terminalSelectionClearTimerRef.current);
      terminalSelectionClearTimerRef.current = null;
    }
  }, []);

  const rememberTerminalSelection = useCallback(
    (text: string) => {
      clearScheduledTerminalSelection();
      const selection = text.trim();
      if (selection) {
        setSelectedTerminalText(text);
        return;
      }
      terminalSelectionClearTimerRef.current = window.setTimeout(() => {
        setSelectedTerminalText("");
        terminalSelectionClearTimerRef.current = null;
      }, 6000);
    },
    [clearScheduledTerminalSelection],
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

  // Fly/Brain connection engine deps — rebuilt every render so async engine
  // callbacks (socket handlers, timers) always read live state through the
  // ref, exactly like the pre-split in-component closures.
  const flyDepsRef = useRef<FlyConnectionDeps>(
    null as unknown as FlyConnectionDeps,
  );
  flyDepsRef.current = {
    chatSessionId,
    terminalRef,
    fitAddonRef,
    transportRef,
    disposedRef,
    sessionEndNotifiedRef,
    flySocketRef,
    flyConnectionStateRef,
    flyTargetKeyRef,
    flyConnectSeqRef,
    flyConnectInFlightKeyRef,
    flyConnectFailureKeyRef,
    flyReconnectTimerRef,
    flyReconnectNoticeRef,
    pendingFlyInputAckTimerRef,
    setFlyConnectionState,
    notifyConnectionState,
    setError,
    setInputSignal,
    setInputSignalBriefly,
    appendCapturedOutput,
    notifyTerminalSessionEnded,
  };

  const connectFlyTerminal = useCallback(
    (opts?: { force?: boolean; resetSession?: boolean }) =>
      connectFly(flyDepsRef, opts),
    [],
  );

  const disconnectFlyTerminal = useCallback(() => {
    disconnectFly(flyDepsRef);
  }, []);

  const scheduleFlyTerminalReconnect = useCallback((reason?: string) => {
    scheduleFlyReconnect(flyDepsRef, reason);
  }, []);

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
          waitForFlyInputAck(flyDepsRef, inputId);
        } else {
          setInputSignalBriefly({
            tone: "blocked",
            label:
              flyConnectionStateRef.current === "restoring"
                ? "Restoring terminal"
                : "Input blocked",
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
    [setInputSignalBriefly],
  );

  const canSendInput = useCallback(() => {
    return isRemoteTerminalTransport(transportRef.current)
      ? flySocketRef.current?.readyState === WebSocket.OPEN &&
          flyConnectionStateRef.current === "connected"
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

  const sendImplementationInput = useCallback(
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;
    let disposables: Array<{ dispose: () => void }> = [];

    void (async () => {
      const mounted = await mountChatTerminal(
        host,
        {
          onData: sendRawInput,
          onSelectionChange: rememberTerminalSelection,
          onResize: sendResize,
          isActive: () => activeRef.current,
        },
        () => disposed,
      );
      if (!mounted) return;

      observer = mounted.observer;
      disposables = mounted.disposables;
      terminalRef.current = mounted.terminal;
      fitAddonRef.current = mounted.fitAddon;
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
  }, [rememberTerminalSelection, sendRawInput, sendResize]);

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

  useEffect(() => {
    function reconnectVisibleRemoteTerminal() {
      if (
        disposedRef.current ||
        !activeRef.current ||
        !isRemoteTerminalTransport(transportRef.current)
      ) {
        return;
      }
      if (
        document.visibilityState === "visible" &&
        flyConnectionStateRef.current !== "connected"
      ) {
        scheduleFlyTerminalReconnect();
      }
    }

    window.addEventListener("focus", reconnectVisibleRemoteTerminal);
    window.addEventListener("online", reconnectVisibleRemoteTerminal);
    document.addEventListener(
      "visibilitychange",
      reconnectVisibleRemoteTerminal,
    );
    return () => {
      window.removeEventListener("focus", reconnectVisibleRemoteTerminal);
      window.removeEventListener("online", reconnectVisibleRemoteTerminal);
      document.removeEventListener(
        "visibilitychange",
        reconnectVisibleRemoteTerminal,
      );
    };
  }, [scheduleFlyTerminalReconnect]);

  const pollOutput = useCallback(
    async (options: { waitMs?: number } = {}) => {
      const current = sessionRef.current;
      if (!current || pollBusyRef.current) return false;

      pollBusyRef.current = true;
      try {
        const params = new URLSearchParams({
          sessionId: current.sessionId,
          cursor: String(current.cursor),
        });
        if (options.waitMs) {
          params.set("waitMs", String(options.waitMs));
        }
        const res = await fetchWithTimeout(
          `/api/kody/chat/terminal/output?${params}`,
          { headers: authHeaders() },
          LOCAL_OUTPUT_READ_TIMEOUT_MS,
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
        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("Terminal output stalled; retrying.");
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
        }
        return false;
      } finally {
        pollBusyRef.current = false;
      }
    },
    [appendCapturedOutput, notifyTerminalSessionEnded, notifyConnectionState],
  );

  useEffect(() => {
    if (!ready || !active) return;
    fitAddonRef.current?.fit();
    if (isRemoteTerminalTransport(transport)) {
      void connectFlyTerminal();
      return;
    }
    disconnectFlyTerminal();
    void start();
  }, [
    active,
    connectFlyTerminal,
    currentTransportKey,
    disconnectFlyTerminal,
    ready,
    start,
    transport,
  ]);

  useEffect(() => {
    if (!active || !session?.sessionId || transport.type !== "local") return;
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        const ok = await pollOutput({ waitMs: LOCAL_OUTPUT_WAIT_MS });
        if (!ok) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
      clearScheduledTerminalSelection();
      clearPendingFlyInputAck(flyDepsRef);
      clearScheduledFlyReconnect(flyDepsRef);
      flyConnectSeqRef.current += 1;
      flyConnectInFlightKeyRef.current = null;
      flySocketRef.current?.close(1000, "terminal unmounted");
    };
  }, [clearScheduledTerminalSelection]);

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
    clearScheduledTerminalSelection();
    setSelectedTerminalText("");
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, [clearScheduledTerminalSelection]);

  const copySelectedTerminalText = useCallback(async () => {
    if (!selectedTerminalText.trim()) return;
    if (!navigator.clipboard) {
      toast.error("Clipboard is not available");
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedTerminalText);
      toast.success("Terminal selection copied");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copy failed");
    }
  }, [selectedTerminalText]);

  const restart = useCallback(() => {
    clearScheduledFlyReconnect(flyDepsRef);
    flyReconnectNoticeRef.current = false;
    setInputSignal({ tone: "blocked", label: "Waiting for terminal" });
    if (isRemoteTerminalTransport(transportRef.current)) {
      void connectFlyTerminal({ force: true, resetSession: true });
      return;
    }
    localStartFailureKeyRef.current = null;
    void stop().then(() => start());
  }, [connectFlyTerminal, start, stop]);

  useImperativeHandle(
    ref,
    () => ({
      sendLine: (line: string) => sendTerminalText(line),
      sendText: (text: string) => sendTerminalText(text),
      executeText: (text: string) => sendImplementationInput(text),
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
          updateFlyConnectionState(flyDepsRef, "closed");
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
      sendImplementationInput,
      sendTerminalText,
    ],
  );

  const statusText = isRemoteTerminalTransport(transport)
    ? (error ??
      `${
        transport.type === "brain"
          ? (transport.label ?? "Brain terminal")
          : (transport.label ?? transport.app)
      } · ${flyConnectionState}`)
    : (error ??
      (session?.alive ? session.cwd : connecting ? "starting" : "closed"));
  const actionBusy =
    connecting ||
    flyConnectionState === "connecting" ||
    flyConnectionState === "restoring";

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
        <div className="flex min-h-12 items-center border-b border-border bg-background px-3 py-2">
          {topToolbar}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden p-2">
        {selectedTerminalText.trim() && (
          <button
            type="button"
            className="absolute right-4 top-4 z-20 rounded-md border border-border bg-background px-2 py-1 text-body-xs text-foreground shadow-sm transition-colors hover:bg-muted"
            onClick={() => void copySelectedTerminalText()}
          >
            Copy selection
          </button>
        )}
        <div
          ref={hostRef}
          className="terminal-scroll-host h-full min-h-0 overflow-auto"
        />
      </div>
    </div>
  );
});
