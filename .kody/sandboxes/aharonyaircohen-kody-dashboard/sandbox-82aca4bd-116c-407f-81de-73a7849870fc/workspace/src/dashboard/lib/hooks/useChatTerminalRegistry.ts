/**
 * @fileType hook
 * @domain terminal
 * @pattern chat-terminal-registry
 *
 * Per-chat terminal UI registry. Chat sessions own their terminal mode,
 * mounted terminal surface, selected transport, and connection state.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { SessionMeta } from "../chat-types";
import type {
  ChatTerminalConnectionState,
  ChatTerminalTransport,
} from "../components/ChatTerminalSurface";
import { authHeaders } from "../components/kody-chat-live-session";

export type ChatTerminalMode = "ai" | "terminal";

export type TerminalFlyFeature =
  | "preview"
  | "preview-base"
  | "runner"
  | "brain"
  | "builder"
  | "other";

export interface TerminalFlyMachine {
  feature: TerminalFlyFeature;
  app: string;
  machineId: string;
  state: string;
  region: string;
  label: string;
}

interface TerminalFlyInventory {
  machines: TerminalFlyMachine[];
}

interface UseChatTerminalRegistryOptions {
  activeSessionId: string | null;
  createSession: () => string;
  sessions: SessionMeta[];
  storageScope?: string;
}

export interface MountedChatTerminal {
  id: string;
  sessionId: string;
  transport: ChatTerminalTransport;
}

export const LOCAL_TERMINAL_TRANSPORT: ChatTerminalTransport = {
  type: "local",
};

const TERMINAL_REGISTRY_STORAGE_KEY_BASE = "kody-chat-terminal-v1";
const TERMINAL_REGISTRY_FALLBACK_KEY = "kody-chat-terminal-v1";
const lastKnownTerminalStorageKey = new Map<string, string>();

interface PersistedTerminalRegistryState {
  version: 1;
  modeBySessionId?: Record<string, ChatTerminalMode>;
  mountedTerminals?: MountedChatTerminal[];
  transportBySessionId?: Record<string, ChatTerminalTransport>;
}

function terminalRegistryStorageKey(scope: string): string {
  const base =
    scope === "global"
      ? TERMINAL_REGISTRY_STORAGE_KEY_BASE
      : `${TERMINAL_REGISTRY_STORAGE_KEY_BASE}-${scope}`;
  if (typeof window === "undefined") return TERMINAL_REGISTRY_FALLBACK_KEY;
  const fallback = () => lastKnownTerminalStorageKey.get(scope) ?? base;
  try {
    const raw = window.localStorage.getItem("kody_auth");
    if (!raw) return fallback();
    const auth = JSON.parse(raw) as { owner?: string; repo?: string };
    if (!auth.owner || !auth.repo) return fallback();
    const key = `${base}:${auth.owner.toLowerCase()}/${auth.repo.toLowerCase()}`;
    lastKnownTerminalStorageKey.set(scope, key);
    return key;
  } catch {
    return fallback();
  }
}

function isTransport(value: unknown): value is ChatTerminalTransport {
  if (!value || typeof value !== "object") return false;
  const transport = value as Partial<ChatTerminalTransport>;
  if (transport.type === "local") {
    return (
      (transport.sandboxId === undefined ||
        typeof transport.sandboxId === "string") &&
      (transport.label === undefined || typeof transport.label === "string")
    );
  }
  return (
    transport.type === "fly" &&
    typeof transport.app === "string" &&
    typeof transport.machineId === "string"
  );
}

function loadPersistedTerminalRegistry(
  storageKey: string,
): Required<PersistedTerminalRegistryState> {
  const fallback: Required<PersistedTerminalRegistryState> = {
    version: 1,
    modeBySessionId: {},
    mountedTerminals: [],
    transportBySessionId: {},
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as PersistedTerminalRegistryState;
    if (parsed.version !== 1) return fallback;

    const transportBySessionId: Record<string, ChatTerminalTransport> = {};
    for (const [sessionId, transport] of Object.entries(
      parsed.transportBySessionId ?? {},
    )) {
      if (isTransport(transport)) transportBySessionId[sessionId] = transport;
    }

    const mountedTerminals = (parsed.mountedTerminals ?? []).filter(
      (terminal) =>
        typeof terminal.id === "string" &&
        typeof terminal.sessionId === "string" &&
        isTransport(terminal.transport),
    );

    return {
      version: 1,
      modeBySessionId: parsed.modeBySessionId ?? {},
      mountedTerminals,
      transportBySessionId,
    };
  } catch {
    return fallback;
  }
}

function savePersistedTerminalRegistry(
  storageKey: string,
  state: PersistedTerminalRegistryState,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* localStorage is best-effort UI persistence */
  }
}

export function canUseChatTerminalFlyMachine(
  machine: TerminalFlyMachine,
): boolean {
  return machine.feature === "runner" || machine.feature === "brain";
}

export function terminalFlyMachineKey(machine: {
  app: string;
  machineId: string;
}): string {
  return `${machine.app}:${machine.machineId}`;
}

export function terminalMachineIdShort(machineId: string): string {
  return machineId.length > 12 ? `${machineId.slice(0, 12)}...` : machineId;
}

function chatTerminalTransportKey(transport: ChatTerminalTransport): string {
  if (transport.type === "fly") return `fly:${transport.app}:${transport.machineId}`;
  return transport.sandboxId ? `local-sandbox:${transport.sandboxId}` : "local";
}

function chatTerminalInstanceId(
  sessionId: string,
  transport: ChatTerminalTransport,
): string {
  return `${sessionId}::${chatTerminalTransportKey(transport)}`;
}

export function useChatTerminalRegistry({
  activeSessionId,
  createSession,
  sessions,
  storageScope = "global",
}: UseChatTerminalRegistryOptions) {
  const storageKey = terminalRegistryStorageKey(storageScope);
  const [initialRegistryState] = useState(() =>
    loadPersistedTerminalRegistry(storageKey),
  );
  const skipNextPersistRef = useRef(true);
  const [modeBySessionId, setModeBySessionId] = useState<
    Record<string, ChatTerminalMode>
  >(initialRegistryState.modeBySessionId);
  const [mountedTerminals, setMountedTerminals] = useState<
    MountedChatTerminal[]
  >(initialRegistryState.mountedTerminals);
  const [transportBySessionId, setTransportBySessionId] = useState<
    Record<string, ChatTerminalTransport>
  >(initialRegistryState.transportBySessionId);
  const [connectNonceByInstanceId, setConnectNonceByInstanceId] = useState<
    Record<string, number>
  >({});
  const [connectionStateByInstanceId, setConnectionStateByInstanceId] =
    useState<Record<string, ChatTerminalConnectionState>>({});
  const [flyInventory, setFlyInventory] = useState<TerminalFlyInventory | null>(
    null,
  );
  const [flyInventoryLoading, setFlyInventoryLoading] = useState(false);
  const [flyInventoryError, setFlyInventoryError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const persisted = loadPersistedTerminalRegistry(storageKey);
    skipNextPersistRef.current = true;
    setModeBySessionId(persisted.modeBySessionId);
    setMountedTerminals(persisted.mountedTerminals);
    setTransportBySessionId(persisted.transportBySessionId);
    setConnectNonceByInstanceId({});
    setConnectionStateByInstanceId({});
  }, [storageKey]);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    savePersistedTerminalRegistry(storageKey, {
      version: 1,
      modeBySessionId,
      mountedTerminals,
      transportBySessionId,
    });
  }, [modeBySessionId, mountedTerminals, storageKey, transportBySessionId]);

  const mode = activeSessionId
    ? (modeBySessionId[activeSessionId] ?? "ai")
    : "ai";
  const terminalMachines = (flyInventory?.machines ?? []).filter(
    canUseChatTerminalFlyMachine,
  );
  const activeTransport = activeSessionId
    ? (transportBySessionId[activeSessionId] ?? LOCAL_TERMINAL_TRANSPORT)
    : LOCAL_TERMINAL_TRANSPORT;
  const activeInstanceId = activeSessionId
    ? chatTerminalInstanceId(activeSessionId, activeTransport)
    : null;
  const activeTargetValue =
    activeTransport.type === "fly"
      ? terminalFlyMachineKey(activeTransport)
      : activeTransport.sandboxId
        ? `sandbox:${activeTransport.sandboxId}`
        : "local";
  const activeConnectionState = activeSessionId
    ? (connectionStateByInstanceId[activeInstanceId ?? ""] ?? "idle")
    : "idle";

  const mountTerminal = useCallback(
    (sessionId: string, transport: ChatTerminalTransport) => {
      const id = chatTerminalInstanceId(sessionId, transport);
      setMountedTerminals((prev) =>
        prev.some((terminal) => terminal.id === id)
          ? prev
          : [...prev, { id, sessionId, transport }],
      );
      return id;
    },
    [],
  );

  const setSessionMode = useCallback(
    (sessionId: string, nextMode: ChatTerminalMode) => {
      setModeBySessionId((prev) =>
        prev[sessionId] === nextMode
          ? prev
          : { ...prev, [sessionId]: nextMode },
      );
    },
    [],
  );

  const setActiveMode = useCallback(
    (nextMode: ChatTerminalMode) => {
      if (!activeSessionId) return;
      setSessionMode(activeSessionId, nextMode);
    },
    [activeSessionId, setSessionMode],
  );

  useEffect(() => {
    const knownSessionIds = new Set(sessions.map((session) => session.id));

    setMountedTerminals((prev) => {
      const next = prev.filter((terminal) =>
        knownSessionIds.has(terminal.sessionId),
      );
      return next.length === prev.length ? prev : next;
    });

    setModeBySessionId((prev) => {
      let changed = false;
      const next: Record<string, ChatTerminalMode> = {};
      for (const [sessionId, mode] of Object.entries(prev)) {
        if (knownSessionIds.has(sessionId)) {
          next[sessionId] = mode;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setTransportBySessionId((prev) => {
      let changed = false;
      const next: Record<string, ChatTerminalTransport> = {};
      for (const [sessionId, transport] of Object.entries(prev)) {
        if (knownSessionIds.has(sessionId)) {
          next[sessionId] = transport;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setConnectNonceByInstanceId((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [instanceId, nonce] of Object.entries(prev)) {
        const sessionId = instanceId.split("::")[0];
        if (knownSessionIds.has(sessionId)) {
          next[instanceId] = nonce;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setConnectionStateByInstanceId((prev) => {
      let changed = false;
      const next: Record<string, ChatTerminalConnectionState> = {};
      for (const [instanceId, state] of Object.entries(prev)) {
        const sessionId = instanceId.split("::")[0];
        if (knownSessionIds.has(sessionId)) {
          next[instanceId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  useEffect(() => {
    if (mode !== "terminal" || !activeSessionId) return;
    mountTerminal(activeSessionId, activeTransport);
  }, [activeSessionId, activeTransport, mode, mountTerminal]);

  const openTerminalMode = useCallback(() => {
    const sessionId = activeSessionId ?? createSession();
    mountTerminal(
      sessionId,
      transportBySessionId[sessionId] ?? LOCAL_TERMINAL_TRANSPORT,
    );
    setSessionMode(sessionId, "terminal");
    return sessionId;
  }, [
    activeSessionId,
    createSession,
    mountTerminal,
    setSessionMode,
    transportBySessionId,
  ]);

  const refreshFlyMachines = useCallback(async () => {
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) {
      setFlyInventory({ machines: [] });
      setFlyInventoryError(null);
      return;
    }

    setFlyInventoryLoading(true);
    setFlyInventoryError(null);
    try {
      const res = await fetch("/api/kody/fly/machines", { headers });
      if (res.status === 503) {
        setFlyInventory({ machines: [] });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      setFlyInventory((await res.json()) as TerminalFlyInventory);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load Fly machines";
      setFlyInventoryError(message);
      setFlyInventory({ machines: [] });
    } finally {
      setFlyInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== "terminal") return;
    void refreshFlyMachines();
  }, [activeSessionId, mode, refreshFlyMachines]);

  const setActiveTransport = useCallback(
    (transport: ChatTerminalTransport) => {
      if (!activeSessionId) return;
      mountTerminal(activeSessionId, transport);
      setTransportBySessionId((prev) =>
        chatTerminalTransportKey(
          prev[activeSessionId] ?? LOCAL_TERMINAL_TRANSPORT,
        ) === chatTerminalTransportKey(transport)
          ? prev
          : { ...prev, [activeSessionId]: transport },
      );
    },
    [activeSessionId, mountTerminal],
  );

  const selectTarget = useCallback(
    (value: string) => {
      if (value === "local") {
        setActiveTransport(LOCAL_TERMINAL_TRANSPORT);
        return;
      }
      const machine = terminalMachines.find(
        (candidate) => terminalFlyMachineKey(candidate) === value,
      );
      if (!machine) return;
      setActiveTransport({
        type: "fly",
        app: machine.app,
        machineId: machine.machineId,
        label: machine.label,
      });
    },
    [setActiveTransport, terminalMachines],
  );

  const selectSandboxTarget = useCallback(
    (sandbox: { id: string; name: string }) => {
      setActiveTransport({
        type: "local",
        sandboxId: sandbox.id,
        label: sandbox.name,
      });
    },
    [setActiveTransport],
  );

  const toggleFlyConnection = useCallback(() => {
    if (!activeSessionId || activeTransport.type !== "fly") return;
    if (
      activeConnectionState === "connected" ||
      activeConnectionState === "connecting"
    ) {
      setActiveTransport(LOCAL_TERMINAL_TRANSPORT);
      return;
    }
    if (!activeInstanceId) return;
    setConnectNonceByInstanceId((prev) => ({
      ...prev,
      [activeInstanceId]: (prev[activeInstanceId] ?? 0) + 1,
    }));
  }, [
    activeConnectionState,
    activeInstanceId,
    activeSessionId,
    activeTransport.type,
    setActiveTransport,
  ]);

  const recordConnectionState = useCallback(
    (instanceId: string, state: ChatTerminalConnectionState) => {
      setConnectionStateByInstanceId((prev) =>
        prev[instanceId] === state ? prev : { ...prev, [instanceId]: state },
      );
    },
    [],
  );

  const hasLiveTerminal = useCallback(
    (sessionId: string | null | undefined) => {
      if (!sessionId) return false;
      return mountedTerminals.some((terminal) => {
        if (terminal.sessionId !== sessionId) return false;
        const state = connectionStateByInstanceId[terminal.id];
        return state === "connected" || state === "connecting";
      });
    },
    [connectionStateByInstanceId, mountedTerminals],
  );

  useEffect(() => {
    if (!activeSessionId) return;
    const localInstanceId = chatTerminalInstanceId(
      activeSessionId,
      LOCAL_TERMINAL_TRANSPORT,
    );
    if (!mountedTerminals.some((terminal) => terminal.id === localInstanceId)) {
      return;
    }

    let cancelled = false;
    const refreshStatus = async () => {
      const headers = authHeaders();
      if (Object.keys(headers).length === 0) return;
      const params = new URLSearchParams({ chatSessionId: activeSessionId });
      try {
        const res = await fetch(`/api/kody/chat/terminal/status?${params}`, {
          headers,
        });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as {
          session?: { alive?: boolean } | null;
        };
        if (cancelled) return;
        const state: ChatTerminalConnectionState = body.session?.alive
          ? "connected"
          : "closed";
        setConnectionStateByInstanceId((prev) =>
          prev[localInstanceId] === state
            ? prev
            : { ...prev, [localInstanceId]: state },
        );
      } catch {
        /* status is advisory; the terminal surface reports hard errors */
      }
    };

    void refreshStatus();
    const interval = setInterval(() => void refreshStatus(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeSessionId, mountedTerminals]);

  useEffect(() => {
    if (!activeSessionId) return;
    const flyTerminals = mountedTerminals.filter(
      (terminal) =>
        terminal.sessionId === activeSessionId &&
        terminal.transport.type === "fly",
    );
    if (flyTerminals.length === 0) return;

    let cancelled = false;
    const refreshStatus = async () => {
      const headers = authHeaders();
      if (Object.keys(headers).length === 0) return;
      await Promise.all(
        flyTerminals.map(async (terminal) => {
          if (terminal.transport.type !== "fly") return;
          try {
            const res = await fetch("/api/kody/terminal/status", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...headers },
              body: JSON.stringify({
                app: terminal.transport.app,
                machineId: terminal.transport.machineId,
                chatSessionId: activeSessionId,
              }),
            });
            if (!res.ok) return;
            const body = (await res.json().catch(() => ({}))) as {
              alive?: boolean;
            };
            if (cancelled) return;
            const state: ChatTerminalConnectionState = body.alive
              ? "connected"
              : "closed";
            setConnectionStateByInstanceId((prev) =>
              prev[terminal.id] === state
                ? prev
                : { ...prev, [terminal.id]: state },
            );
          } catch {
            /* status is advisory; reconnect reports hard errors */
          }
        }),
      );
    };

    void refreshStatus();
    const interval = setInterval(() => void refreshStatus(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeSessionId, mountedTerminals]);

  return {
    activeConnectionState,
    activeInstanceId,
    activeTargetValue,
    activeTransport,
    connectNonceByInstanceId,
    flyInventoryError,
    flyInventoryLoading,
    hasLiveTerminal,
    mode,
    modeBySessionId,
    mountedTerminals,
    openTerminalMode,
    recordConnectionState,
    refreshFlyMachines,
    selectSandboxTarget,
    selectTarget,
    setActiveMode,
    terminalMachines,
    toggleFlyConnection,
    transportBySessionId,
  };
}
