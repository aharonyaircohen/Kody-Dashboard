/**
 * @fileType utility
 * @domain terminal
 * @pattern terminal-session-policy
 *
 * Pure helpers for deciding which Fly machines may expose a browser terminal
 * and for building the dashboard-managed bridge websocket URL.
 */
import type {
  FlyFeature,
  FlyInventory,
  FlyMachineRow,
} from "@dashboard/lib/runners/fly-inventory";

export type TerminalTargetError =
  | "machine_not_found"
  | "machine_not_terminal_capable"
  | "machine_not_running";

export interface TerminalTargetInput {
  app: string;
  machineId: string;
  feature?: FlyFeature;
}

export interface TerminalTargetResult {
  ok: true;
  machine: FlyMachineRow;
}

export interface TerminalTargetFailure {
  ok: false;
  error: TerminalTargetError;
}

const TERMINAL_FEATURES = new Set<FlyFeature>(["brain"]);
const LIVE_STATES = new Set(["started", "running"]);
const STARTABLE_STATES = new Set(["suspended", "stopped"]);

export function isTerminalFeatureAllowed(feature: FlyFeature): boolean {
  return TERMINAL_FEATURES.has(feature);
}

export function isTerminalMachineLive(state: string): boolean {
  return LIVE_STATES.has(state);
}

export function isTerminalMachineStartable(state: string): boolean {
  return STARTABLE_STATES.has(state);
}

export function upsertTerminalTargetMachine(
  inventory: FlyInventory,
  machine: FlyMachineRow,
  orgSlug: string,
): void {
  inventory.machines = inventory.machines.filter(
    (item) =>
      item.app !== machine.app || item.machineId !== machine.machineId,
  );
  inventory.machines.push({ ...machine, orgSlug: machine.orgSlug ?? orgSlug });
  inventory.total = inventory.machines.length;
  inventory.running = inventory.machines.filter((item) =>
    isTerminalMachineLive(item.state),
  ).length;
}

export function findTerminalTargetMachine(
  inventory: FlyInventory,
  input: TerminalTargetInput,
): FlyMachineRow | null {
  return (
    inventory.machines.find(
      (m) => m.app === input.app && m.machineId === input.machineId,
    ) ?? null
  );
}

export function resolveTerminalTargetMachine(
  inventory: FlyInventory,
  input: TerminalTargetInput,
): FlyMachineRow | null {
  const exact = findTerminalTargetMachine(inventory, input);
  if (exact) return exact;

  if (input.feature === "brain") {
    const brainMachines = inventory.machines.filter(
      (m) => m.feature === "brain",
    );
    return brainMachines.length === 1 ? brainMachines[0] : null;
  }

  const brainMachinesForApp = inventory.machines.filter(
    (m) => m.app === input.app && m.feature === "brain",
  );
  return brainMachinesForApp.length === 1 ? brainMachinesForApp[0] : null;
}

export function resolveBrainTerminalTargetInput(
  inventory: FlyInventory,
  input?: { app?: string; machineId?: string; feature?: FlyFeature } | null,
): { app: string; machineId: string; feature: "brain" } | null {
  if (input?.app && input.machineId) {
    const target = resolveTerminalTargetMachine(inventory, {
      app: input.app,
      machineId: input.machineId,
      feature: "brain",
    });
    if (target?.feature === "brain") {
      return {
        app: target.app,
        machineId: target.machineId,
        feature: "brain",
      };
    }
  }

  const brainMachines = inventory.machines.filter(
    (machine) => machine.feature === "brain",
  );
  if (brainMachines.length !== 1) return null;
  return {
    app: brainMachines[0].app,
    machineId: brainMachines[0].machineId,
    feature: "brain",
  };
}

export function selectTerminalTarget(
  inventory: FlyInventory,
  input: TerminalTargetInput,
): TerminalTargetResult | TerminalTargetFailure {
  const machine = resolveTerminalTargetMachine(inventory, input);
  if (!machine) return { ok: false, error: "machine_not_found" };
  if (!isTerminalFeatureAllowed(machine.feature)) {
    return { ok: false, error: "machine_not_terminal_capable" };
  }
  if (!isTerminalMachineLive(machine.state)) {
    return { ok: false, error: "machine_not_running" };
  }
  return { ok: true, machine };
}

export function terminalActivityLimitForTarget(
  feature: FlyFeature,
  requested: number | null | undefined,
): number | null | undefined {
  return feature === "brain" ? requested : undefined;
}

export function buildTerminalWebSocketUrl(
  bridgeBase: string,
  token: string,
): string {
  const trimmed = bridgeBase.trim().replace(/\/$/, "");
  if (!trimmed) throw new Error("terminal bridge URL missing");
  const url = new URL(
    trimmed.startsWith("ws://") || trimmed.startsWith("wss://")
      ? trimmed
      : trimmed.replace(/^http:/, "ws:").replace(/^https:/, "wss:"),
  );
  url.searchParams.set("token", token);
  return url.toString();
}
