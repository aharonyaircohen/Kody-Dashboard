/**
 * @fileType hook
 * @domain chat-plugin-terminal
 * @pattern chat-terminal-registry
 *
 * Per-chat terminal UI registry. Chat sessions own their terminal mode,
 * mounted terminal surface, selected transport, and connection state.
 * All state rules live in registry-state.ts (pure, behavior-tested);
 * this hook is the React wiring: state, persistence effects, and the
 * Fly-inventory / status polling loops (polling cadence ≥ 15s — see
 * tests/unit/rate-limit-polling.spec.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionMeta } from "../../../chat-types";
import { authHeaders } from "../../core/kody-chat-live-session";
import type { ServerProviderMachineRow } from "@dashboard/lib/infrastructure/server-machine-model";
import {
  FLY_MACHINES_REFRESH_EVENT,
  LOCAL_TERMINAL_TRANSPORT,
  canUseChatTerminalFlyMachine,
  chatTerminalInstanceId,
  chatTerminalTransportKey,
  chatTerminalTransportsEqual,
  loadPersistedTerminalRegistry,
  localTerminalStatusPath,
  mountedChatTerminalListsEqual,
  normalizeTerminalTransport,
  pruneInstanceKeyedRecord,
  pruneMountedChatTerminals,
  pruneSessionKeyedRecord,
  reconcileMountedChatTerminalsWithInventory,
  remoteTerminalStatusRequest,
  resolveTerminalTargetSelection,
  savePersistedTerminalRegistry,
  terminalRegistryStorageKey,
  terminalTargetValue,
  upsertMountedChatTerminal,
} from "./registry-state";
import type {
  ChatTerminalConnectionState,
  ChatTerminalMode,
  ChatTerminalTransport,
  MountedChatTerminal,
} from "./types";

export type { ChatTerminalMode, MountedChatTerminal } from "./types";
export {
  BRAIN_TERMINAL_TRANSPORT,
  LOCAL_TERMINAL_TRANSPORT,
  canUseChatTerminalFlyMachine,
  findMountedBrainTerminal,
  isBrainTerminalTransport,
  normalizeMountedChatTerminals,
  normalizeTerminalTransport,
  reconcileMountedChatTerminalsWithInventory,
  terminalFlyMachineKey,
  terminalMachineIdShort,
  upsertMountedChatTerminal,
} from "./registry-state";

interface TerminalServerProviderInventory {
  machines: ServerProviderMachineRow[];
}

interface UseChatTerminalRegistryOptions {
  activeSessionId: string | null;
  createSession: () => string;
  sessions: SessionMeta[];
  sessionsHydrated?: boolean;
  storageScope?: string;
}

export function useChatTerminalRegistry({
  activeSessionId,
  createSession,
  sessions,
  sessionsHydrated = true,
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
  const [connectionStateByInstanceId, setConnectionStateByInstanceId] =
    useState<Record<string, ChatTerminalConnectionState>>({});
  const [flyInventory, setServerProviderInventory] =
    useState<TerminalServerProviderInventory | null>(null);
  const [flyInventoryLoading, setServerProviderInventoryLoading] =
    useState(false);
  const [flyInventoryError, setServerProviderInventoryError] = useState<
    string | null
  >(null);

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
  const activeTargetValue = terminalTargetValue(activeTransport);
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

  useEffect(() => {
    if (!sessionsHydrated) return;

    const knownSessionIds = new Set(sessions.map((session) => session.id));

    setMountedTerminals((prev) =>
      pruneMountedChatTerminals(prev, knownSessionIds),
    );
    setModeBySessionId((prev) =>
      pruneSessionKeyedRecord(prev, knownSessionIds),
    );
    setTransportBySessionId((prev) =>
      pruneSessionKeyedRecord(prev, knownSessionIds),
    );
    setConnectionStateByInstanceId((prev) =>
      pruneInstanceKeyedRecord(prev, knownSessionIds),
    );
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
      mountTerminal,
      setSessionMode,
      terminalMachines,
      transportBySessionId,
    ],
  );

  const refreshFlyMachines = useCallback(async () => {
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) {
      setServerProviderInventory({ machines: [] });
      setServerProviderInventoryError(null);
      return;
    }

    setServerProviderInventoryLoading(true);
    setServerProviderInventoryError(null);
    try {
      const res = await fetch("/api/kody/fly/machines", { headers });
      if (res.status === 503) {
        setServerProviderInventory({ machines: [] });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      setServerProviderInventory(
        (await res.json()) as TerminalServerProviderInventory,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load Fly machines";
      setServerProviderInventoryError(message);
      setServerProviderInventory({ machines: [] });
    } finally {
      setServerProviderInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => void refreshFlyMachines();
    window.addEventListener(FLY_MACHINES_REFRESH_EVENT, refresh);
    return () =>
      window.removeEventListener(FLY_MACHINES_REFRESH_EVENT, refresh);
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
      mountTerminal(activeSessionId, nextTransport);
      setTransportBySessionId((prev) =>
        chatTerminalTransportKey(
          prev[activeSessionId] ?? LOCAL_TERMINAL_TRANSPORT,
        ) === chatTerminalTransportKey(nextTransport)
          ? prev
          : { ...prev, [activeSessionId]: nextTransport },
      );
    },
    [activeSessionId, flyInventory, mountTerminal, terminalMachines],
  );

  const selectTarget = useCallback(
    (value: string) => {
      const transport = resolveTerminalTargetSelection(value, terminalMachines);
      if (!transport) return;
      setActiveTransport(transport);
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
        return (
          state === "connected" ||
          state === "connecting" ||
          state === "restoring"
        );
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
          try {
            const res = await fetch(localTerminalStatusPath(activeSessionId), {
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
    const interval = setInterval(() => void refreshStatus(), 60_000);
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
          const statusRequest = remoteTerminalStatusRequest(
            terminal.transport,
            activeSessionId,
          );
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
    const interval = setInterval(() => void refreshStatus(), 60_000);
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
