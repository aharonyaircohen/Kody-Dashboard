import { describe, expect, it } from "vitest";

import {
  buildTerminalWebSocketUrl,
  findTerminalTargetMachine,
  isTerminalFeatureAllowed,
  isTerminalMachineStartable,
  resolveTerminalTargetMachine,
  selectTerminalTarget,
  terminalActivityLimitForTarget,
  terminalBridgeSessionIdForTarget,
} from "@dashboard/lib/terminal/session";
import type { FlyInventory } from "@dashboard/lib/runners/fly-inventory";

const INVENTORY: FlyInventory = {
  running: 2,
  total: 5,
  machines: [
    {
      feature: "runner",
      app: "kody-runner",
      machineId: "runner-1",
      state: "started",
      region: "fra",
      label: "kody-runner",
      sizeLabel: "perf 1x · 2 GB",
    },
    {
      feature: "brain",
      app: "kody-brain-alice",
      machineId: "brain-1",
      state: "started",
      region: "fra",
      label: "kody-brain-alice",
      sizeLabel: "perf 1x · 2 GB",
    },
    {
      feature: "brain",
      app: "kody-brain-bob",
      machineId: "brain-2",
      state: "suspended",
      region: "fra",
      label: "kody-brain-bob",
      sizeLabel: "perf 1x · 2 GB",
    },
    {
      feature: "preview",
      app: "kp-acme-widgets-pr-7",
      machineId: "preview-1",
      state: "started",
      region: "fra",
      label: "PR #7",
      sizeLabel: "shared 1x · 512 MB",
    },
    {
      feature: "runner",
      app: "kody-runner",
      machineId: "runner-2",
      state: "suspended",
      region: "fra",
      label: "kody-runner",
      sizeLabel: "perf 1x · 2 GB",
    },
  ],
};

describe("terminal session policy", () => {
  it("allows only Brain machines as Fly terminal targets", () => {
    expect(isTerminalFeatureAllowed("runner")).toBe(false);
    expect(isTerminalFeatureAllowed("brain")).toBe(true);
    expect(isTerminalFeatureAllowed("preview")).toBe(false);
    expect(isTerminalFeatureAllowed("builder")).toBe(false);
  });

  it("rejects live runner machines", () => {
    const selected = selectTerminalTarget(INVENTORY, {
      app: "kody-runner",
      machineId: "runner-1",
    });

    expect(selected).toEqual({
      ok: false,
      error: "machine_not_terminal_capable",
    });
  });

  it("selects a live brain machine", () => {
    const selected = selectTerminalTarget(INVENTORY, {
      app: "kody-brain-alice",
      machineId: "brain-1",
    });

    expect(selected).toMatchObject({
      ok: true,
      machine: { machineId: "brain-1" },
    });
  });

  it("uses the current Brain machine when the saved machine id is stale", () => {
    expect(
      resolveTerminalTargetMachine(INVENTORY, {
        app: "kody-brain-alice",
        machineId: "destroyed-brain",
      }),
    ).toMatchObject({ machineId: "brain-1", feature: "brain" });
    expect(
      selectTerminalTarget(INVENTORY, {
        app: "kody-brain-alice",
        machineId: "destroyed-brain",
      }),
    ).toMatchObject({
      ok: true,
      machine: { machineId: "brain-1", feature: "brain" },
    });
  });

  it("rejects non-Brain machines", () => {
    const selected = selectTerminalTarget(INVENTORY, {
      app: "kp-acme-widgets-pr-7",
      machineId: "preview-1",
    });

    expect(selected).toEqual({
      ok: false,
      error: "machine_not_terminal_capable",
    });
  });

  it("rejects suspended Brain machines until they wake", () => {
    const selected = selectTerminalTarget(INVENTORY, {
      app: "kody-brain-bob",
      machineId: "brain-2",
    });

    expect(selected).toEqual({ ok: false, error: "machine_not_running" });
  });

  it("identifies sleeping Brain machines as startable terminal targets", () => {
    expect(isTerminalMachineStartable("suspended")).toBe(true);
    expect(isTerminalMachineStartable("stopped")).toBe(true);
    expect(isTerminalMachineStartable("destroyed")).toBe(false);
    expect(
      findTerminalTargetMachine(INVENTORY, {
        app: "kody-brain-bob",
        machineId: "brain-2",
      }),
    ).toMatchObject({ state: "suspended", feature: "brain" });
  });

  it("builds the bridge websocket URL without leaking another query shape", () => {
    expect(
      buildTerminalWebSocketUrl("https://terminal.example/ws", "abc"),
    ).toBe("wss://terminal.example/ws?token=abc");
    expect(
      buildTerminalWebSocketUrl("wss://terminal.example/ws?x=1", "abc"),
    ).toBe("wss://terminal.example/ws?x=1&token=abc");
  });

  it("applies custom terminal activity limits only to Brain machines", () => {
    expect(terminalActivityLimitForTarget("brain", 60 * 60_000)).toBe(
      60 * 60_000,
    );
    expect(terminalActivityLimitForTarget("brain", null)).toBeNull();
    expect(
      terminalActivityLimitForTarget("runner", 60 * 60_000),
    ).toBeUndefined();
    expect(terminalActivityLimitForTarget("preview", null)).toBeUndefined();
  });

  it("uses a stable bridge session id for Brain terminals", () => {
    expect(
      terminalBridgeSessionIdForTarget({
        owner: "acme",
        repo: "widgets",
        app: "kody-brain-alice",
        machineId: "brain-1",
        feature: "brain",
        requestedChatSessionId: "browser-chat-1",
      }),
    ).toBe("brain:acme:widgets:kody-brain-alice:brain-1");
    expect(
      terminalBridgeSessionIdForTarget({
        owner: "acme",
        repo: "widgets",
        app: "kody-runner",
        machineId: "runner-1",
        feature: "runner",
        requestedChatSessionId: "browser-chat-1",
      }),
    ).toBe("browser-chat-1");
  });
});
