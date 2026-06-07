/**
 * @fileType component
 * @domain terminal
 * @pattern runner-terminal-page
 *
 * Full-page terminal surface for Fly runner and Brain machines. The browser renders a
 * real xterm instance; the dashboard-managed bridge owns the websocket-to-PTY
 * hop.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Copy,
  Loader2,
  Power,
  RefreshCw,
  SquareTerminal,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";

import { Button } from "@dashboard/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { getStoredAuth } from "../api";
import { cn } from "../utils";
import { PageShell } from "./PageShell";

type FlyFeature =
  | "preview"
  | "preview-base"
  | "runner"
  | "brain"
  | "litellm"
  | "builder"
  | "other";

interface FlyMachineRow {
  feature: FlyFeature;
  app: string;
  machineId: string;
  name?: string;
  state: string;
  region: string;
  label: string;
  sizeLabel: string;
  createdAt?: string;
}

interface Inventory {
  machines: FlyMachineRow[];
  running: number;
  total: number;
}

interface TerminalSessionResponse {
  ok: true;
  app: string;
  machineId: string;
  label: string;
  expiresAt: string;
  webSocketUrl: string;
}

type ConnectionState = "idle" | "connecting" | "connected" | "closed" | "error";
type MachineActionState = "idle" | "starting";

function authHeaders(): Record<string, string> {
  const auth = getStoredAuth();
  return auth
    ? {
        "x-kody-token": auth.token,
        "x-kody-owner": auth.owner,
        "x-kody-repo": auth.repo,
      }
    : {};
}

function machineKey(machine: FlyMachineRow): string {
  return `${machine.app}:${machine.machineId}`;
}

function machineIdShort(machineId: string): string {
  return machineId.length > 12 ? `${machineId.slice(0, 12)}...` : machineId;
}

function stateClass(state: string): string {
  if (state === "started" || state === "running") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }
  if (state === "suspended") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }
  return "border-white/10 bg-white/5 text-white/45";
}

function isMachineLive(state: string): boolean {
  return state === "started" || state === "running";
}

function canStartMachine(state: string): boolean {
  return state === "suspended" || state === "stopped";
}

function canUseTerminal(feature: FlyFeature): boolean {
  return feature === "runner" || feature === "brain";
}

function selectedMachineFromInventory(
  inventory: Inventory | null,
  selectedKey: string,
): FlyMachineRow | null {
  return (
    (inventory?.machines ?? []).find(
      (machine) => machineKey(machine) === selectedKey,
    ) ?? null
  );
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

export function TerminalManager() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryApp = searchParams.get("app") ?? "";
  const queryMachineId = searchParams.get("machineId") ?? "";
  const queryConnect = searchParams.get("connect") === "1";

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<XTermFitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const autoStartedRef = useRef(false);

  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [terminalReady, setTerminalReady] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [machineActionState, setMachineActionState] =
    useState<MachineActionState>("idle");
  const [error, setError] = useState<string | null>(null);

  const terminalMachines = useMemo(
    () => (inventory?.machines ?? []).filter((m) => canUseTerminal(m.feature)),
    [inventory],
  );

  const selectedMachine = useMemo(
    () => terminalMachines.find((m) => machineKey(m) === selectedKey) ?? null,
    [terminalMachines, selectedKey],
  );

  const selectedCanConnect = selectedMachine
    ? isMachineLive(selectedMachine.state)
    : false;
  const selectedCanStart = selectedMachine
    ? canStartMachine(selectedMachine.state)
    : false;

  const writeSystemLine = useCallback((message: string) => {
    terminalRef.current?.writeln(`\x1b[38;5;245m${message}\x1b[0m`);
  }, []);

  const refresh = useCallback(async () => {
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) {
      setError("Connect a repository first.");
      setInventory(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kody/fly/machines", { headers });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const next = (await res.json()) as Inventory;
      setInventory(next);
      const fromQuery = next.machines.find(
        (m) =>
          canUseTerminal(m.feature) &&
          m.app === queryApp &&
          m.machineId === queryMachineId,
      );
      const fallback = next.machines.find((m) => canUseTerminal(m.feature));
      setSelectedKey((current) => {
        if (fromQuery) return machineKey(fromQuery);
        if (current && next.machines.some((m) => machineKey(m) === current)) {
          return current;
        }
        return fallback ? machineKey(fallback) : "";
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load Fly machines";
      setError(message);
      setInventory(null);
    } finally {
      setLoading(false);
    }
  }, [queryApp, queryMachineId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    let disposed = false;
    let terminal: XTerm | null = null;
    let observer: ResizeObserver | null = null;
    const disposables: Array<{ dispose: () => void }> = [];

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;

      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        convertEol: true,
        fontFamily:
          "'SFMono-Regular', 'Cascadia Code', 'Liberation Mono', Menlo, monospace",
        fontSize: 13,
        lineHeight: 1.25,
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
      terminal.writeln("\x1b[38;5;245mFly machine terminal\x1b[0m");

      disposables.push(
        terminal.onData((data) => {
          const ws = socketRef.current;
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        }),
      );
      disposables.push(
        terminal.onResize(({ cols, rows }) => {
          const ws = socketRef.current;
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "resize", cols, rows }));
          }
        }),
      );

      observer = new ResizeObserver(() => {
        requestAnimationFrame(() => fitAddon.fit());
      });
      observer.observe(host);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      setTerminalReady(true);
    })();

    return () => {
      disposed = true;
      socketRef.current?.close();
      observer?.disconnect();
      for (const disposable of disposables) disposable.dispose();
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.close(1000, "user disconnect");
    socketRef.current = null;
    setConnectionState("closed");
  }, []);

  const refreshInventory = useCallback(async (): Promise<Inventory> => {
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) {
      throw new Error("Connect a repository first.");
    }
    const res = await fetch("/api/kody/fly/machines", { headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
    }
    const next = (await res.json()) as Inventory;
    setInventory(next);
    return next;
  }, []);

  const startSelectedMachine = useCallback(async (): Promise<FlyMachineRow> => {
    if (!selectedMachine) throw new Error("Select a terminal-capable machine.");
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) {
      throw new Error("Connect a repository first.");
    }

    setMachineActionState("starting");
    writeSystemLine(
      `Starting ${selectedMachine.app} ${selectedMachine.machineId}`,
    );
    try {
      const res = await fetch("/api/kody/fly/machines/action", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          app: selectedMachine.app,
          machineId: selectedMachine.machineId,
          action: "start",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }

      for (let attempt = 0; attempt < 10; attempt++) {
        const nextInventory = await refreshInventory();
        const nextMachine = selectedMachineFromInventory(
          nextInventory,
          machineKey(selectedMachine),
        );
        if (nextMachine && isMachineLive(nextMachine.state)) {
          writeSystemLine("Machine is running");
          return nextMachine;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error("Machine is still waking up. Try Connect again.");
    } finally {
      setMachineActionState("idle");
    }
  }, [refreshInventory, selectedMachine, writeSystemLine]);

  const connect = useCallback(async (overrideMachine?: FlyMachineRow) => {
    if (!terminalReady) {
      setError("Terminal is still starting.");
      return;
    }
    const machine = overrideMachine ?? selectedMachine;
    if (!machine) {
      setError("Select a terminal-capable machine.");
      return;
    }
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) {
      setError("Connect a repository first.");
      return;
    }

    socketRef.current?.close();
    socketRef.current = null;
    setConnectionState("connecting");
    setError(null);
    writeSystemLine(`Connecting to ${machine.app} ${machine.machineId}`);

    try {
      fitAddonRef.current?.fit();
      const term = terminalRef.current;
      const res = await fetch("/api/kody/terminal/session", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          app: machine.app,
          machineId: machine.machineId,
          cols: term?.cols ?? 120,
          rows: term?.rows ?? 36,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const session = (await res.json()) as TerminalSessionResponse;
      const ws = new WebSocket(session.webSocketUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        writeSystemLine("Bridge connected");
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
        const raw =
          typeof event.data === "string"
            ? event.data
            : await (event.data as Blob).text();
        const message = parseBridgeMessage(raw);
        if (!message) {
          terminalRef.current?.write(raw);
          return;
        }
        if (message.type === "output" && typeof message.data === "string") {
          terminalRef.current?.write(message.data);
          return;
        }
        if (message.type === "ready") {
          setConnectionState("connected");
          writeSystemLine("Terminal ready");
          terminalRef.current?.focus();
          return;
        }
        if (message.type === "error") {
          setConnectionState("error");
          setError(message.message ?? "Terminal bridge error");
          writeSystemLine(message.message ?? "Terminal bridge error");
          return;
        }
        if (message.type === "exit") {
          setConnectionState("closed");
          writeSystemLine(
            `Process exited${message.code === undefined ? "" : ` (${message.code})`}`,
          );
        }
      };
      ws.onerror = () => {
        setConnectionState("error");
        setError("Terminal websocket error.");
        writeSystemLine("Terminal websocket error");
      };
      ws.onclose = () => {
        if (socketRef.current === ws) socketRef.current = null;
        setConnectionState((current) =>
          current === "error" ? "error" : "closed",
        );
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect terminal";
      setConnectionState("error");
      setError(message);
      writeSystemLine(message);
    }
  }, [selectedMachine, terminalReady, writeSystemLine]);

  const wakeAndConnect = useCallback(async () => {
    if (!selectedMachine) {
      setError("Select a terminal-capable machine.");
      return;
    }
    try {
      setError(null);
      if (isMachineLive(selectedMachine.state)) {
        await connect(selectedMachine);
        return;
      }
      if (!canStartMachine(selectedMachine.state)) {
        setError(
          `Machine is ${selectedMachine.state}. Pick a running or sleeping terminal-capable machine.`,
        );
        return;
      }
      const machine = await startSelectedMachine();
      await connect(machine);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start terminal";
      setConnectionState("error");
      setError(message);
      writeSystemLine(message);
    }
  }, [connect, selectedMachine, startSelectedMachine, writeSystemLine]);

  useEffect(() => {
    if (
      !queryConnect ||
      autoStartedRef.current ||
      !selectedMachine ||
      !terminalReady
    ) {
      return;
    }
    autoStartedRef.current = true;
    void wakeAndConnect();
  }, [queryConnect, selectedMachine, terminalReady, wakeAndConnect]);

  function selectMachine(machine: FlyMachineRow) {
    setSelectedKey(machineKey(machine));
    router.replace(
      `/terminal?app=${encodeURIComponent(machine.app)}&machineId=${encodeURIComponent(machine.machineId)}`,
      { scroll: false },
    );
  }

  function selectMachineKey(nextKey: string) {
    const machine = terminalMachines.find((m) => machineKey(m) === nextKey);
    if (machine) selectMachine(machine);
  }

  async function copyBuffer() {
    const terminal = terminalRef.current;
    const buffer = terminal?.buffer.active;
    if (!buffer) return;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    }
    await navigator.clipboard.writeText(lines.join("\n").trimEnd());
  }

  const stateLabel =
    machineActionState === "starting"
      ? "starting"
      : connectionState === "connected"
        ? "connected"
        : connectionState === "connecting"
          ? "connecting"
          : connectionState;

  return (
    <PageShell
      width="full"
      title="Machine Terminal"
      icon={SquareTerminal}
      iconClassName="text-emerald-400"
      subtitle={selectedMachine ? selectedMachine.app : "Fly machine"}
      actions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href="/runner">Runner</Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh machines"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </>
      }
      contentClassName="min-h-0 flex flex-col flex-1"
    >
      <div className="flex flex-1 min-h-[70vh] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-2">
          <div className="min-w-[260px] flex-1 sm:max-w-[520px]">
            <Select
              value={selectedKey}
              onValueChange={selectMachineKey}
              disabled={terminalMachines.length === 0}
            >
              <SelectTrigger className="h-9 border-white/[0.08] bg-black/25 text-xs text-white/85">
                <SelectValue placeholder="No runner or Brain machines" />
              </SelectTrigger>
              <SelectContent>
                {terminalMachines.map((machine) => (
                  <SelectItem key={machineKey(machine)} value={machineKey(machine)}>
                    {machine.label} · {machine.state} · {machine.region} ·{" "}
                    {machineIdShort(machine.machineId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="text-[11px] text-white/35">
            {terminalMachines.length} machines
          </span>
        </div>

        <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/[0.08] bg-[#050608] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-white/[0.08] bg-white/[0.03] px-3 py-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px]",
                connectionState === "connected"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : connectionState === "connecting"
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
                    : "border-white/10 bg-white/5 text-white/45",
              )}
            >
              {stateLabel}
            </span>
            {selectedMachine && (
              <span className="min-w-0 truncate text-xs text-white/50">
                {selectedMachine.app} ·{" "}
                {machineIdShort(selectedMachine.machineId)}
                {!selectedCanConnect && canStartMachine(selectedMachine.state)
                  ? " · will wake on connect"
                  : ""}
              </span>
            )}
            {error && (
              <span className="min-w-0 truncate text-xs text-rose-300">
                {error}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyBuffer()}
                title="Copy output"
                className="h-7 px-2"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
              {connectionState === "connected" ||
              connectionState === "connecting" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={disconnect}
                  title="Disconnect"
                  className="h-7 px-2 text-rose-300 hover:text-rose-200"
                >
                  <Unplug className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void wakeAndConnect()}
                  disabled={
                    !selectedMachine ||
                    !terminalReady ||
                    machineActionState === "starting" ||
                    (!selectedCanConnect && !selectedCanStart)
                  }
                  title={
                    selectedCanConnect
                      ? "Connect"
                      : selectedCanStart
                        ? "Start and connect"
                        : "Select a running or suspended machine"
                  }
                  className="h-7 px-2 text-emerald-300 hover:text-emerald-200"
                >
                  {machineActionState === "starting" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Power className="w-3.5 h-3.5" />
                  )}
                </Button>
              )}
            </div>
          </div>
          <div ref={terminalHostRef} className="h-[calc(100%-45px)] p-2" />
        </section>
      </div>
    </PageShell>
  );
}
