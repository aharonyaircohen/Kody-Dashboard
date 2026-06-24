import { describe, expect, it } from "vitest";

import {
  buildTerminalWebSocketUrl,
  findTerminalTargetMachine,
  isTerminalFeatureAllowed,
  isTerminalMachineStartable,
  selectTerminalTarget,
  terminalActivityLimitForTarget,
} from "@dashboard/lib/terminal/session";
import type { FlyInventory } from "@dashboard/lib/runners/fly-inventory";

const INVENTORY: FlyInventory = {
  running: 2,
  total: 3,
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
  it("allows runner and brain machines", () => {
    expect(isTerminalFeatureAllowed("runner")).toBe(true);
    expect(isTerminalFeatureAllowed("brain")).toBe(true);
    expect(isTerminalFeatureAllowed("preview")).toBe(false);
    expect(isTerminalFeatureAllowed("builder")).toBe(false);
  });

  it("selects a live runner machine", () => {
    const selected = selectTerminalTarget(INVENTORY, {
      app: "kody-runner",
      machineId: "runner-1",
    });

    expect(selected).toMatchObject({
      ok: true,
      machine: { machineId: "runner-1" },
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

  it("rejects non-runner machines", () => {
    const selected = selectTerminalTarget(INVENTORY, {
      app: "kp-acme-widgets-pr-7",
      machineId: "preview-1",
    });

    expect(selected).toEqual({
      ok: false,
      error: "machine_not_terminal_capable",
    });
  });

  it("rejects suspended machines", () => {
    const selected = selectTerminalTarget(INVENTORY, {
      app: "kody-runner",
      machineId: "runner-2",
    });

    expect(selected).toEqual({ ok: false, error: "machine_not_running" });
  });

  it("identifies sleeping runners as startable terminal targets", () => {
    expect(isTerminalMachineStartable("suspended")).toBe(true);
    expect(isTerminalMachineStartable("stopped")).toBe(true);
    expect(isTerminalMachineStartable("destroyed")).toBe(false);
    expect(
      findTerminalTargetMachine(INVENTORY, {
        app: "kody-runner",
        machineId: "runner-2",
      }),
    ).toMatchObject({ state: "suspended", feature: "runner" });
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
});
