/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern registry-state
 * @ai-summary Pure state logic for the per-chat terminal registry: transport
 *   normalization (Brain is a semantic intent, not a machine id), mounted
 *   terminal upsert/reconcile, session pruning gated on chat-session
 *   hydration, localStorage persistence codec, and target selection/status
 *   request builders. Extracted from useChatTerminalRegistry in Step 5a so
 *   every rule is behavior-testable without React.
 */
import {
  isFlyTerminalCapable,
  type ServerProviderMachineRow,
} from "@dashboard/lib/infrastructure/server-machine-model";
import type {
  ChatTerminalConnectionState,
  ChatTerminalMode,
  ChatTerminalTransport,
  MountedChatTerminal,
} from "./types";

export const LOCAL_TERMINAL_TRANSPORT: ChatTerminalTransport = {
  type: "local",
};
export const BRAIN_TERMINAL_TRANSPORT: ChatTerminalTransport = {
  type: "brain",
  label: "Brain terminal",
};

/** Window event that forces a Fly machine inventory refresh (image apply). */
export const FLY_MACHINES_REFRESH_EVENT = "kody:fly-machines-refresh";

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
  return supported;
}

export function chatTerminalTransportsEqual(
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

export function mountedChatTerminalListsEqual(
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
  const [normalizedNext] = normalizeMountedChatTerminals([nextTerminal]);
  if (!normalizedNext) return terminals;
  const existingIndex = terminals.findIndex(
    (terminal) => terminal.id === normalizedNext.id,
  );
  if (existingIndex === -1) {
    return normalizeMountedChatTerminals([...terminals, normalizedNext]);
  }
  if (mountedChatTerminalsEqual(terminals[existingIndex], normalizedNext)) {
    return terminals;
  }
  return normalizeMountedChatTerminals(
    terminals.map((terminal, index) =>
      index === existingIndex ? normalizedNext : terminal,
    ),
  );
}

const TERMINAL_REGISTRY_STORAGE_KEY_BASE = "kody-chat-terminal-v1";
const TERMINAL_REGISTRY_FALLBACK_KEY = "kody-chat-terminal-v1";
const lastKnownTerminalStorageKey = new Map<string, string>();

export interface PersistedTerminalRegistryState {
  version: 1;
  modeBySessionId?: Record<string, ChatTerminalMode>;
  mountedTerminals?: MountedChatTerminal[];
  transportBySessionId?: Record<string, ChatTerminalTransport>;
}

export function terminalRegistryStorageKey(scope: string): string {
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

export function loadPersistedTerminalRegistry(
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

export function savePersistedTerminalRegistry(
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
  machine: ServerProviderMachineRow,
): boolean {
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

export function chatTerminalTransportFromMachine(
  machine: ServerProviderMachineRow,
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
  terminalMachines: ServerProviderMachineRow[],
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

export function chatTerminalTransportKey(
  transport: ChatTerminalTransport,
): string {
  if (transport.type === "brain") return "brain";
  if (transport.type === "fly")
    return `fly:${transport.app}:${transport.machineId}`;
  return "local";
}

export function chatTerminalInstanceId(
  sessionId: string,
  transport: ChatTerminalTransport,
): string {
  return `${sessionId}::${chatTerminalTransportKey(transport)}`;
}

/** The target-picker value for a transport ("local" | "brain" | app:machine). */
export function terminalTargetValue(transport: ChatTerminalTransport): string {
  return transport.type === "brain"
    ? "brain"
    : transport.type === "fly"
      ? terminalFlyMachineKey(transport)
      : "local";
}

/**
 * Resolve a target-picker value back to a transport. Brain is selected as a
 * semantic intent — never a machine id. Unknown machine keys resolve to
 * null (selection ignored).
 */
export function resolveTerminalTargetSelection(
  value: string,
  terminalMachines: ServerProviderMachineRow[],
): ChatTerminalTransport | null {
  if (value === "local") return LOCAL_TERMINAL_TRANSPORT;
  if (value === "brain") return BRAIN_TERMINAL_TRANSPORT;
  const machine = terminalMachines.find(
    (candidate) => terminalFlyMachineKey(candidate) === value,
  );
  if (!machine) return null;
  return chatTerminalTransportFromMachine(machine);
}

export function reconcileMountedChatTerminalsWithInventory(
  terminals: MountedChatTerminal[],
  terminalMachines: ServerProviderMachineRow[],
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

/** Prune mounted terminals to known chat sessions (identity-preserving). */
export function pruneMountedChatTerminals(
  terminals: MountedChatTerminal[],
  knownSessionIds: ReadonlySet<string>,
): MountedChatTerminal[] {
  const next = terminals.filter((terminal) =>
    knownSessionIds.has(terminal.sessionId),
  );
  return next.length === terminals.length ? terminals : next;
}

/** Prune a sessionId-keyed record to known sessions (identity-preserving). */
export function pruneSessionKeyedRecord<T>(
  record: Record<string, T>,
  knownSessionIds: ReadonlySet<string>,
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [sessionId, value] of Object.entries(record)) {
    if (knownSessionIds.has(sessionId)) {
      next[sessionId] = value;
    } else {
      changed = true;
    }
  }
  return changed ? next : record;
}

/**
 * Prune an instanceId-keyed record (`<sessionId>::<transportKey>`) to known
 * sessions (identity-preserving).
 */
export function pruneInstanceKeyedRecord<T>(
  record: Record<string, T>,
  knownSessionIds: ReadonlySet<string>,
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [instanceId, value] of Object.entries(record)) {
    const sessionId = instanceId.split("::")[0];
    if (knownSessionIds.has(sessionId)) {
      next[instanceId] = value;
    } else {
      changed = true;
    }
  }
  return changed ? next : record;
}

export interface TerminalRegistryPruneState {
  mountedTerminals: MountedChatTerminal[];
  modeBySessionId: Record<string, ChatTerminalMode>;
  transportBySessionId: Record<string, ChatTerminalTransport>;
  connectionStateByInstanceId: Record<string, ChatTerminalConnectionState>;
}

/**
 * Drop registry entries for chat sessions that no longer exist. Returns the
 * SAME state object when nothing changed (React identity contract) — and,
 * critically, when the chat-session store has not hydrated yet, so restored
 * terminals are never pruned against an empty session list.
 */
export function pruneTerminalRegistryToSessions(
  state: TerminalRegistryPruneState,
  knownSessionIds: ReadonlySet<string>,
  sessionsHydrated: boolean,
): TerminalRegistryPruneState {
  if (!sessionsHydrated) return state;

  const mountedTerminals = pruneMountedChatTerminals(
    state.mountedTerminals,
    knownSessionIds,
  );
  const modeBySessionId = pruneSessionKeyedRecord(
    state.modeBySessionId,
    knownSessionIds,
  );
  const transportBySessionId = pruneSessionKeyedRecord(
    state.transportBySessionId,
    knownSessionIds,
  );
  const connectionStateByInstanceId = pruneInstanceKeyedRecord(
    state.connectionStateByInstanceId,
    knownSessionIds,
  );

  if (
    mountedTerminals === state.mountedTerminals &&
    modeBySessionId === state.modeBySessionId &&
    transportBySessionId === state.transportBySessionId &&
    connectionStateByInstanceId === state.connectionStateByInstanceId
  ) {
    return state;
  }

  return {
    mountedTerminals,
    modeBySessionId,
    transportBySessionId,
    connectionStateByInstanceId,
  };
}

/**
 * Local terminal status is scoped per CHAT SESSION (never a sandbox id) —
 * the status probe asks "does this chat session have a live local pty".
 */
export function localTerminalStatusPath(chatSessionId: string): string {
  const params = new URLSearchParams({ chatSessionId });
  return `/api/kody/chat/terminal/status?${params}`;
}

/**
 * Remote terminal status request body: Brain terminals probe by semantic
 * target; Fly terminals by app + machine id. Both carry the chat session.
 */
export function remoteTerminalStatusRequest(
  transport: Exclude<ChatTerminalTransport, { type: "local" }>,
  chatSessionId: string,
): Record<string, unknown> {
  if (transport.type === "brain") {
    return { target: "brain", chatSessionId };
  }
  return {
    app: transport.app,
    machineId: transport.machineId,
    feature: transport.feature,
    chatSessionId,
  };
}
