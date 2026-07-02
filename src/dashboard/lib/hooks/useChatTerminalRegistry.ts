/**
 * @fileType hook
 * @domain terminal
 * @pattern chat-terminal-registry
 *
 * Per-chat terminal UI registry. Chat sessions own their terminal mode,
 * mounted terminal surface, selected transport, and connection state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionMeta } from "../chat-types";
import type {
  ChatTerminalConnectionState,
  ChatTerminalTransport,
} from "../components/ChatTerminalSurface";
import { authHeaders } from "../components/kody-chat-live-session";
import {
  isFlyTerminalCapable,
  type FlyMachineRow,
} from "../runners/fly-machine-model";

export type ChatTerminalMode = "ai" | "terminal";

interface TerminalFlyInventory {
  machines: FlyMachineRow[];
}

interface UseChatTerminalRegistryOptions {
  activeSessionId: string | null;
  createSession: () => string;
  sessions: SessionMeta[];
  sessionsHydrated?: boolean;
  storageScope?: string;
  switchSession?: (sessionId: string) => void;
}

export interface MountedChatTerminal {
  id: string;
  sessionId: string;
  transport: ChatTerminalTransport;
}

export function isBrainTerminalTransport(
  transport: ChatTerminalTransport,
): boolean {
  return (
    transport.type === "brain" ||
    (transport.type === "fly" && transport.feature === "brain")
  );
}

export function findMountedBrainTerminal(
  terminals: MountedChatTerminal[],
): MountedChatTerminal | null {
  for (let index = terminals.length - 1; index >= 0; index -= 1) {
    if (isBrainTerminalTransport(terminals[index].transport)) {
      return terminals[index];
    }
  }
  return null;
}

export function normalizeMountedChatTerminals(
  terminals: MountedChatTerminal[],
): MountedChatTerminal[] {
  const supported = terminals.flatMap((terminal): MountedChatTerminal[] => {
    if (isBrainTerminalTransport(terminal.transport)) {
      const transport = BRAIN_TERMINAL_TRANSPORT;
      return [
        {
          ...terminal,
          id: `${terminal.sessionId}::${chatTerminalTransportKey(transport)}`,
          transport,
        },
      ];
    }
    if (terminal.transport.type !== "local") return [];
    const transport = terminal.transport.label
      ? ({ type: "local", label: terminal.transport.label } as const)
      : ({ type: "local" } as const);
    return [
      {
        ...terminal,
        id: `${terminal.sessionId}::${chatTerminalTransportKey(transport)}`,
        transport,
      },
    ];
  });
  const activeBrain = findMountedBrainTerminal(supported);
  if (!activeBrain) return supported;
  return supported.filter(
    (terminal) =>
      !isBrainTerminalTransport(terminal.transport) ||
      terminal.id === activeBrain.id,
  );
}

function chatTerminalTransportsEqual(
  first: ChatTerminalTransport,
  second: ChatTerminalTransport,
): boolean {
  if (first.type !== second.type) return false;
  if (first.type === "local" && second.type === "local") {
    return first.label === second.label;
  }
  if (first.type === "brain" && second.type === "brain") {
    return true;
  }
  if (first.type === "fly" && second.type === "fly") {
    return (
      first.app === second.app &&
      first.machineId === second.machineId &&
      first.feature === second.feature &&
      first.label === second.label
    );
  }
  return false;
}

function mountedChatTerminalsEqual(
  first: MountedChatTerminal,
  second: MountedChatTerminal,
): boolean {
  return (
    first.id === second.id &&
    first.sessionId === second.sessionId &&
    chatTerminalTransportsEqual(first.transport, second.transport)
  );
}

function mountedChatTerminalListsEqual(
  first: MountedChatTerminal[],
  second: MountedChatTerminal[],
): boolean {
  return (
    first.length === second.length &&
    first.every((terminal, index) =>
      mountedChatTerminalsEqual(terminal, second[index]),
    )
  );
}

export function upsertMountedChatTerminal(
  terminals: MountedChatTerminal[],
  nextTerminal: MountedChatTerminal,
): MountedChatTerminal[] {
  if (!isBrainTerminalTransport(nextTerminal.transport)) {
    return terminals.some((terminal) => terminal.id === nextTerminal.id)
      ? terminals
      : [...terminals, nextTerminal];
  }

  const existingBrain = findMountedBrainTerminal(terminals);
  if (!existingBrain)
    return normalizeMountedChatTerminals([...terminals, nextTerminal]);
  if (mountedChatTerminalsEqual(existingBrain, nextTerminal)) return terminals;

  return normalizeMountedChatTerminals(
    terminals.map((terminal) =>
      terminal.id === existingBrain.id ? nextTerminal : terminal,
    ),
  );
}

export const LOCAL_TERMINAL_TRANSPORT: ChatTerminalTransport = {
  type: "local",
};
export const BRAIN_TERMINAL_TRANSPORT: ChatTerminalTransport = {
  type: "brain",
  label: "Brain terminal",
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
    return transport.label === undefined || typeof transport.label === "string";
  }
  if (transport.type === "brain") {
    return transport.label === undefined || typeof transport.label === "string";
  }
  return (
    transport.type === "fly" &&
    typeof transport.app === "string" &&
    typeof transport.machineId === "string" &&
    (transport.feature === undefined ||
      transport.feature === "runner" ||
      transport.feature === "brain")
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

    const mountedTerminals = normalizeMountedChatTerminals(
      (parsed.mountedTerminals ?? []).filter(
        (terminal) =>
          typeof terminal.id === "string" &&
          typeof terminal.sessionId === "string" &&
          isTransport(terminal.transport),
      ),
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

export function canUseChatTerminalFlyMachine(machine: FlyMachineRow): boolean {
  return isFlyTerminalCapable(machine.feature);
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

function chatTerminalTransportFromMachine(
  machine: FlyMachineRow,
): ChatTerminalTransport {
  if (machine.feature === "brain") return BRAIN_TERMINAL_TRANSPORT;
  const transport: ChatTerminalTransport = {
    type: "fly",
    app: machine.app,
    machineId: machine.machineId,
    label: machine.label,
  };
  if (machine.feature === "runner") {
    transport.feature = machine.feature;
  }
  return transport;
}

export function normalizeTerminalTransport(
  transport: ChatTerminalTransport,
  terminalMachines: FlyMachineRow[],
  _options: { inventoryLoaded?: boolean } = {},
): ChatTerminalTransport {
  if (transport.type !== "fly") {
    if (transport.type === "brain") return BRAIN_TERMINAL_TRANSPORT;
    return transport.label
      ? { type: "local", label: transport.label }
      : LOCAL_TERMINAL_TRANSPORT;
  }
  if (transport.feature === "brain") return BRAIN_TERMINAL_TRANSPORT;

  const machine = terminalMachines.find(
    (candidate) =>
      candidate.app === transport.app &&
      candidate.machineId === transport.machineId,
  );
  if (machine) {
    return chatTerminalTransportFromMachine(machine);
  }
  return LOCAL_TERMINAL_TRANSPORT;
}

function chatTerminalTransportKey(transport: ChatTerminalTransport): string {
  if (transport.type === "brain") return "brain";
  if (transport.type === "fly")
    return `fly:${transport.app}:${transport.machineId}`;
  return "local";
}

function chatTerminalInstanceId(
  sessionId: string,
  transport: ChatTerminalTransport,
): string {
  return `${sessionId}::${chatTerminalTransportKey(transport)}`;
}

export function reconcileMountedChatTerminalsWithInventory(
  terminals: MountedChatTerminal[],
  terminalMachines: FlyMachineRow[],
  options: { inventoryLoaded?: boolean } = {},
): MountedChatTerminal[] {
  return normalizeMountedChatTerminals(
    terminals.map((terminal) => {
      const transport = normalizeTerminalTransport(
        terminal.transport,
        terminalMachines,
        options,
      );
      const id = chatTerminalInstanceId(terminal.sessionId, transport);
      if (
        terminal.id === id &&
        chatTerminalTransportsEqual(terminal.transport, transport)
      ) {
        return terminal;
      }
      return { ...terminal, id, transport };
    }),
  );
}

export function useChatTerminalRegistry({
  activeSessionId,
  createSession,
  sessions,
  sessionsHydrated = true,
  storageScope = "global",
  switchSession,
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
  const terminalMachines = useMemo(
    () => (flyInventory?.machines ?? []).filter(canUseChatTerminalFlyMachine),
    [flyInventory],
  );
  const activeTransportBase = activeSessionId
    ? (transportBySessionId[activeSessionId] ?? LOCAL_TERMINAL_TRANSPORT)
    : LOCAL_TERMINAL_TRANSPORT;
  const activeTransport = normalizeTerminalTransport(
    activeTransportBase,
    terminalMachines,
    { inventoryLoaded: flyInventory !== null },
  );
  const activeInstanceId = activeSessionId
    ? chatTerminalInstanceId(activeSessionId, activeTransport)
    : null;
  const activeTargetValue =
    activeTransport.type === "brain"
      ? "brain"
      : activeTransport.type === "fly"
        ? terminalFlyMachineKey(activeTransport)
        : "local";
  const activeConnectionState = activeSessionId
    ? (connectionStateByInstanceId[activeInstanceId ?? ""] ?? "idle")
    : "idle";

  const mountTerminal = useCallback(
    (sessionId: string, transport: ChatTerminalTransport) => {
      const id = chatTerminalInstanceId(sessionId, transport);
      setMountedTerminals((prev) => {
        return upsertMountedChatTerminal(prev, { id, sessionId, transport });
      });
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

  const focusMountedBrainTerminal = useCallback(
    (transport: ChatTerminalTransport): string | null => {
      if (!isBrainTerminalTransport(transport)) return null;
      const existingBrain = findMountedBrainTerminal(mountedTerminals);
      if (!existingBrain) return null;
      setMountedTerminals((prev) =>
        upsertMountedChatTerminal(prev, {
          id: chatTerminalInstanceId(existingBrain.sessionId, transport),
          sessionId: existingBrain.sessionId,
          transport,
        }),
      );
      setTransportBySessionId((prev) =>
        chatTerminalTransportKey(
          prev[existingBrain.sessionId] ?? LOCAL_TERMINAL_TRANSPORT,
        ) === chatTerminalTransportKey(transport)
          ? prev
          : { ...prev, [existingBrain.sessionId]: transport },
      );
      setSessionMode(existingBrain.sessionId, "terminal");
      switchSession?.(existingBrain.sessionId);
      return existingBrain.sessionId;
    },
    [mountedTerminals, setSessionMode, switchSession],
  );

  useEffect(() => {
    if (!sessionsHydrated) return;

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
  }, [sessions, sessionsHydrated]);

  useEffect(() => {
    if (mode !== "terminal" || !activeSessionId) return;
    mountTerminal(activeSessionId, activeTransport);
  }, [activeSessionId, activeTransport, mode, mountTerminal]);

  const openTerminalMode = useCallback(
    (transport?: ChatTerminalTransport) => {
      const sessionId = activeSessionId ?? createSession();
      const terminalTransport = normalizeTerminalTransport(
        transport ??
          transportBySessionId[sessionId] ??
          LOCAL_TERMINAL_TRANSPORT,
        terminalMachines,
        { inventoryLoaded: flyInventory !== null },
      );
      const existingBrainSessionId =
        focusMountedBrainTerminal(terminalTransport);
      if (existingBrainSessionId) return existingBrainSessionId;
      mountTerminal(sessionId, terminalTransport);
      if (transport) {
        setTransportBySessionId((prev) =>
          chatTerminalTransportKey(
            prev[sessionId] ?? LOCAL_TERMINAL_TRANSPORT,
          ) === chatTerminalTransportKey(terminalTransport)
            ? prev
            : { ...prev, [sessionId]: terminalTransport },
        );
      }
      setSessionMode(sessionId, "terminal");
      return sessionId;
    },
    [
      activeSessionId,
      createSession,
      flyInventory,
      focusMountedBrainTerminal,
      mountTerminal,
      setSessionMode,
      terminalMachines,
      transportBySessionId,
    ],
  );

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
    const refresh = () => void refreshFlyMachines();
    window.addEventListener("kody:fly-machines-refresh", refresh);
    return () =>
      window.removeEventListener("kody:fly-machines-refresh", refresh);
  }, [refreshFlyMachines]);

  useEffect(() => {
    if (mode !== "terminal") return;
    void refreshFlyMachines();
  }, [activeSessionId, mode, refreshFlyMachines]);

  useEffect(() => {
    if (flyInventory === null) return;
    setMountedTerminals((prev) => {
      const next = reconcileMountedChatTerminalsWithInventory(
        prev,
        terminalMachines,
        { inventoryLoaded: true },
      );
      return mountedChatTerminalListsEqual(prev, next) ? prev : next;
    });
    setTransportBySessionId((prev) => {
      let changed = false;
      const next: Record<string, ChatTerminalTransport> = {};
      for (const [sessionId, transport] of Object.entries(prev)) {
        const normalized = normalizeTerminalTransport(
          transport,
          terminalMachines,
          { inventoryLoaded: true },
        );
        next[sessionId] = normalized;
        if (!chatTerminalTransportsEqual(transport, normalized)) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [flyInventory, terminalMachines]);

  const setActiveTransport = useCallback(
    (transport: ChatTerminalTransport) => {
      if (!activeSessionId) return;
      const nextTransport = normalizeTerminalTransport(
        transport,
        terminalMachines,
        { inventoryLoaded: flyInventory !== null },
      );
      if (focusMountedBrainTerminal(nextTransport)) return;
      mountTerminal(activeSessionId, nextTransport);
      setTransportBySessionId((prev) =>
        chatTerminalTransportKey(
          prev[activeSessionId] ?? LOCAL_TERMINAL_TRANSPORT,
        ) === chatTerminalTransportKey(nextTransport)
          ? prev
          : { ...prev, [activeSessionId]: nextTransport },
      );
    },
    [
      activeSessionId,
      flyInventory,
      focusMountedBrainTerminal,
      mountTerminal,
      terminalMachines,
    ],
  );

  const selectTarget = useCallback(
    (value: string) => {
      if (value === "local") {
        setActiveTransport(LOCAL_TERMINAL_TRANSPORT);
        return;
      }
      if (value === "brain") {
        setActiveTransport(BRAIN_TERMINAL_TRANSPORT);
        return;
      }
      const machine = terminalMachines.find(
        (candidate) => terminalFlyMachineKey(candidate) === value,
      );
      if (!machine) return;
      setActiveTransport(chatTerminalTransportFromMachine(machine));
    },
    [setActiveTransport, terminalMachines],
  );

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
    const localTerminals = mountedTerminals.filter(
      (terminal) =>
        terminal.sessionId === activeSessionId &&
        terminal.transport.type === "local",
    );
    if (localTerminals.length === 0) return;

    let cancelled = false;
    const refreshStatus = async () => {
      const headers = authHeaders();
      if (Object.keys(headers).length === 0) return;
      await Promise.all(
        localTerminals.map(async (terminal) => {
          if (terminal.transport.type !== "local") return;
          const params = new URLSearchParams({
            chatSessionId: activeSessionId,
          });
          try {
            const res = await fetch(
              `/api/kody/chat/terminal/status?${params}`,
              { headers },
            );
            if (!res.ok) return;
            const body = (await res.json().catch(() => ({}))) as {
              session?: { alive?: boolean } | null;
            };
            if (cancelled) return;
            const state: ChatTerminalConnectionState = body.session?.alive
              ? "connected"
              : "closed";
            setConnectionStateByInstanceId((prev) =>
              prev[terminal.id] === state
                ? prev
                : { ...prev, [terminal.id]: state },
            );
          } catch {
            /* status is advisory; the terminal surface reports hard errors */
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

  useEffect(() => {
    if (!activeSessionId) return;
    const flyTerminals = mountedTerminals.filter(
      (terminal) =>
        terminal.sessionId === activeSessionId &&
        (terminal.transport.type === "fly" ||
          terminal.transport.type === "brain"),
    );
    if (flyTerminals.length === 0) return;

    let cancelled = false;
    const refreshStatus = async () => {
      const headers = authHeaders();
      if (Object.keys(headers).length === 0) return;
      await Promise.all(
        flyTerminals.map(async (terminal) => {
          if (
            terminal.transport.type !== "fly" &&
            terminal.transport.type !== "brain"
          ) {
            return;
          }
          const statusRequest =
            terminal.transport.type === "brain"
              ? {
                  target: "brain",
                  chatSessionId: activeSessionId,
                }
              : {
                  app: terminal.transport.app,
                  machineId: terminal.transport.machineId,
                  feature: terminal.transport.feature,
                  chatSessionId: activeSessionId,
                };
          try {
            const res = await fetch("/api/kody/terminal/status", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...headers },
              body: JSON.stringify(statusRequest),
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
    flyInventoryError,
    flyInventoryLoading,
    hasLiveTerminal,
    mode,
    modeBySessionId,
    mountedTerminals,
    openTerminalMode,
    recordConnectionState,
    refreshFlyMachines,
    restoreTerminalTransport: setActiveTransport,
    selectTarget,
    setActiveMode,
    terminalMachines,
    transportBySessionId,
  };
}
