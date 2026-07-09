/**
 * @fileoverview Behavior coverage for the terminal plugin's registry state
 *   (Step 5a REWRITE of chat-terminal-registry-refresh.spec.ts and the
 *   source-text half of chat-terminal-registry-brain-singleton.spec.ts):
 *   Brain is a per-chat semantic intent, restored terminals survive until
 *   chat sessions hydrate, status probes are scoped per chat session, and
 *   targets reconcile after a Brain image apply.
 * @testFramework vitest
 * @domain chat-plugins
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BRAIN_TERMINAL_TRANSPORT,
  LOCAL_TERMINAL_TRANSPORT,
  canUseChatTerminalFlyMachine,
  findMountedBrainTerminal,
  isBrainTerminalTransport,
  loadPersistedTerminalRegistry,
  localTerminalStatusPath,
  normalizeMountedChatTerminals,
  normalizeTerminalTransport,
  pruneInstanceKeyedRecord,
  pruneMountedChatTerminals,
  pruneSessionKeyedRecord,
  pruneTerminalRegistryToSessions,
  reconcileMountedChatTerminalsWithInventory,
  remoteTerminalStatusRequest,
  resolveTerminalTargetSelection,
  savePersistedTerminalRegistry,
  terminalTargetValue,
  upsertMountedChatTerminal,
} from "@dashboard/lib/chat/plugins/terminal/registry-state";
import type { MountedChatTerminal } from "@dashboard/lib/chat/plugins/terminal/types";
import type { FlyMachineRow } from "@dashboard/lib/infrastructure/plugins/fly/runners/machine-model";

function terminal(
  id: string,
  sessionId: string,
  feature?: "brain" | "runner",
): MountedChatTerminal {
  if (feature === "brain") {
    return {
      id,
      sessionId,
      transport: BRAIN_TERMINAL_TRANSPORT,
    };
  }
  return {
    id,
    sessionId,
    transport: {
      type: "fly",
      app: "runner-app",
      machineId: id,
      feature,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat terminal registry Brain sessions", () => {
  it("filters Fly terminal choices to Brain machines only", () => {
    const baseMachine = {
      app: "kody-runner",
      machineId: "machine-1",
      state: "started",
      region: "fra",
      label: "machine",
      sizeLabel: "perf 1x · 2 GB",
    } satisfies Omit<FlyMachineRow, "feature">;

    expect(
      canUseChatTerminalFlyMachine({ ...baseMachine, feature: "brain" }),
    ).toBe(true);
    expect(
      canUseChatTerminalFlyMachine({ ...baseMachine, feature: "runner" }),
    ).toBe(false);
  });

  it("recognizes Brain as a semantic terminal transport", () => {
    expect(isBrainTerminalTransport(BRAIN_TERMINAL_TRANSPORT)).toBe(true);
    expect(
      isBrainTerminalTransport({
        type: "fly",
        app: "brain",
        machineId: "m1",
        feature: "brain",
      }),
    ).toBe(true);
    expect(
      isBrainTerminalTransport({
        type: "fly",
        app: "runner",
        machineId: "m1",
        feature: "runner",
      }),
    ).toBe(false);
  });

  it("keeps one mounted Brain terminal per chat session", () => {
    const firstBrain = terminal("brain-1", "chat-1", "brain");
    const secondBrain = terminal("brain-2", "chat-2", "brain");

    expect(normalizeMountedChatTerminals([firstBrain, secondBrain])).toEqual([
      {
        id: "chat-1::brain",
        sessionId: "chat-1",
        transport: BRAIN_TERMINAL_TRANSPORT,
      },
      {
        id: "chat-2::brain",
        sessionId: "chat-2",
        transport: BRAIN_TERMINAL_TRANSPORT,
      },
    ]);
  });

  it("adds a second chat Brain terminal without replacing the first", () => {
    const firstBrain = {
      id: "chat-1::brain",
      sessionId: "chat-1",
      transport: BRAIN_TERMINAL_TRANSPORT,
    } satisfies MountedChatTerminal;
    const selectedBrain = {
      id: "chat-2::brain",
      sessionId: "chat-2",
      transport: BRAIN_TERMINAL_TRANSPORT,
    } satisfies MountedChatTerminal;

    expect(upsertMountedChatTerminal([firstBrain], selectedBrain)).toEqual([
      firstBrain,
      selectedBrain,
    ]);
  });

  it("normalizes stale Brain machine selections to semantic Brain intent", () => {
    const staleTransport = {
      type: "fly",
      app: "brain-app",
      machineId: "old-machine",
      feature: "brain",
      label: "Brain server",
    } as const;
    const currentBrain = {
      app: "brain-app",
      machineId: "new-machine",
      state: "started",
      region: "fra",
      label: "Brain server",
      sizeLabel: "shared 2x · 4 GB",
      feature: "brain",
    } satisfies FlyMachineRow;

    expect(
      normalizeTerminalTransport(staleTransport, [currentBrain], {
        inventoryLoaded: true,
      }),
    ).toEqual(BRAIN_TERMINAL_TRANSPORT);
  });

  it("preserves restored Brain intent without depending on Fly inventory", () => {
    const staleTransport = {
      type: "fly",
      app: "brain-app",
      machineId: "old-machine",
      feature: "brain",
      label: "Brain server",
    } as const;

    expect(
      normalizeTerminalTransport(staleTransport, [], {
        inventoryLoaded: false,
      }),
    ).toEqual(BRAIN_TERMINAL_TRANSPORT);
    expect(
      normalizeTerminalTransport(staleTransport, [], {
        inventoryLoaded: true,
      }),
    ).toEqual(BRAIN_TERMINAL_TRANSPORT);
  });

  it("does not remount Brain when the selected target is unchanged", () => {
    const mounted = [
      {
        id: "chat-1::local",
        sessionId: "chat-1",
        transport: { type: "local" },
      },
      {
        id: "chat-1::brain",
        sessionId: "chat-1",
        transport: BRAIN_TERMINAL_TRANSPORT,
      },
    ] satisfies MountedChatTerminal[];

    expect(
      upsertMountedChatTerminal(mounted, {
        id: "chat-1::brain",
        sessionId: "chat-1",
        transport: BRAIN_TERMINAL_TRANSPORT,
      }),
    ).toBe(mounted);
  });

  it("selects Brain as an intent instead of a machine id", () => {
    // Behavior pin (was a source-text read): picking "brain" in the target
    // dropdown resolves to the semantic Brain transport, never a machine.
    expect(resolveTerminalTargetSelection("brain", [])).toEqual(
      BRAIN_TERMINAL_TRANSPORT,
    );
    expect(terminalTargetValue(BRAIN_TERMINAL_TRANSPORT)).toBe("brain");
    expect(resolveTerminalTargetSelection("local", [])).toEqual(
      LOCAL_TERMINAL_TRANSPORT,
    );
    // Unknown machine keys are ignored (no transport change).
    expect(resolveTerminalTargetSelection("gone-app:gone-machine", [])).toBe(
      null,
    );
    // A known runner machine resolves to its Fly transport.
    const machine = {
      app: "runner-app",
      machineId: "m-9",
      state: "started",
      region: "fra",
      label: "runner",
      sizeLabel: "perf 1x · 2 GB",
      feature: "runner",
    } satisfies FlyMachineRow;
    expect(resolveTerminalTargetSelection("runner-app:m-9", [machine])).toEqual(
      {
        type: "fly",
        app: "runner-app",
        machineId: "m-9",
        label: "runner",
        feature: "runner",
      },
    );
  });

  it("finds the most recent mounted Brain terminal", () => {
    const older = terminal("chat-1::brain", "chat-1", "brain");
    const newer = terminal("chat-2::brain", "chat-2", "brain");
    expect(findMountedBrainTerminal([older, newer])).toBe(newer);
    expect(findMountedBrainTerminal([terminal("local", "chat-1")])).toBeNull();
  });
});

describe("chat terminal registry refresh persistence", () => {
  const mounted = [
    {
      id: "chat-1::brain",
      sessionId: "chat-1",
      transport: BRAIN_TERMINAL_TRANSPORT,
    },
    {
      id: "chat-2::local",
      sessionId: "chat-2",
      transport: { type: "local" },
    },
  ] satisfies MountedChatTerminal[];

  it("does not prune restored terminals before chat sessions hydrate", () => {
    const state = {
      mountedTerminals: mounted,
      modeBySessionId: { "chat-1": "terminal" as const },
      transportBySessionId: { "chat-1": BRAIN_TERMINAL_TRANSPORT },
      connectionStateByInstanceId: { "chat-1::brain": "connected" as const },
    };
    // Sessions have NOT hydrated: an empty session list must not wipe the
    // restored registry.
    expect(pruneTerminalRegistryToSessions(state, new Set(), false)).toBe(
      state,
    );
    // Once hydrated, unknown sessions ARE pruned.
    const pruned = pruneTerminalRegistryToSessions(
      state,
      new Set(["chat-2"]),
      true,
    );
    expect(pruned.mountedTerminals).toEqual([mounted[1]]);
    expect(pruned.modeBySessionId).toEqual({});
    expect(pruned.transportBySessionId).toEqual({});
    expect(pruned.connectionStateByInstanceId).toEqual({});
  });

  it("prunes each collection identity-preservingly", () => {
    const known = new Set(["chat-1", "chat-2"]);
    expect(pruneMountedChatTerminals(mounted, known)).toBe(mounted);
    const modes = { "chat-1": "terminal" as const };
    expect(pruneSessionKeyedRecord(modes, known)).toBe(modes);
    const connections = { "chat-2::local": "connected" as const };
    expect(pruneInstanceKeyedRecord(connections, known)).toBe(connections);
    expect(pruneInstanceKeyedRecord(connections, new Set(["chat-1"]))).toEqual(
      {},
    );
  });

  it("refreshes status for local terminals by chat session only", () => {
    // The local status probe is keyed by chatSessionId — never a sandbox id.
    expect(localTerminalStatusPath("chat-7")).toBe(
      "/api/kody/chat/terminal/status?chatSessionId=chat-7",
    );
    expect(localTerminalStatusPath("chat-7")).not.toContain("sandboxId");
  });

  it("probes remote terminals by semantic Brain target or Fly machine", () => {
    expect(remoteTerminalStatusRequest({ type: "brain" }, "chat-1")).toEqual({
      target: "brain",
      chatSessionId: "chat-1",
    });
    expect(
      remoteTerminalStatusRequest(
        { type: "fly", app: "runner-app", machineId: "m-1", feature: "runner" },
        "chat-1",
      ),
    ).toEqual({
      app: "runner-app",
      machineId: "m-1",
      feature: "runner",
      chatSessionId: "chat-1",
    });
  });

  it("reconciles Brain terminal targets after image apply", () => {
    const staleBrainMachine = [
      {
        id: "chat-1::fly:brain-app:old-machine",
        sessionId: "chat-1",
        transport: {
          type: "fly",
          app: "brain-app",
          machineId: "old-machine",
          feature: "brain",
        },
      },
    ] satisfies MountedChatTerminal[];
    const inventoryAfterApply = [
      {
        app: "brain-app",
        machineId: "new-machine",
        state: "started",
        region: "fra",
        label: "Brain server",
        sizeLabel: "shared 2x · 4 GB",
        feature: "brain",
      },
    ] satisfies FlyMachineRow[];

    expect(
      reconcileMountedChatTerminalsWithInventory(
        staleBrainMachine,
        inventoryAfterApply,
        { inventoryLoaded: true },
      ),
    ).toEqual([
      {
        id: "chat-1::brain",
        sessionId: "chat-1",
        transport: BRAIN_TERMINAL_TRANSPORT,
      },
    ]);
  });

  it("round-trips the persisted registry and drops malformed transports", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    });

    savePersistedTerminalRegistry("test-key", {
      version: 1,
      modeBySessionId: { "chat-1": "terminal" },
      mountedTerminals: [
        {
          id: "chat-1::brain",
          sessionId: "chat-1",
          transport: BRAIN_TERMINAL_TRANSPORT,
        },
        // Malformed entry — must be filtered on load.
        {
          id: "chat-2::bogus",
          sessionId: "chat-2",
          transport: { type: "gha" } as never,
        },
      ],
      transportBySessionId: {
        "chat-1": BRAIN_TERMINAL_TRANSPORT,
        "chat-2": { type: "gha" } as never,
      },
    });

    const loaded = loadPersistedTerminalRegistry("test-key");
    expect(loaded.modeBySessionId).toEqual({ "chat-1": "terminal" });
    expect(loaded.mountedTerminals).toEqual([
      {
        id: "chat-1::brain",
        sessionId: "chat-1",
        transport: BRAIN_TERMINAL_TRANSPORT,
      },
    ]);
    expect(loaded.transportBySessionId).toEqual({
      "chat-1": BRAIN_TERMINAL_TRANSPORT,
    });
  });
});
