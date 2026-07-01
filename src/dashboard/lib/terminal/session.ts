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

export function findTerminalTargetMachine(
  inventory: FlyInventory,
  input: { app: string; machineId: string; feature?: FlyFeature },
): FlyMachineRow | null {
  return (
    inventory.machines.find(
      (m) => m.app === input.app && m.machineId === input.machineId,
    ) ?? null
  );
}

export function resolveTerminalTargetMachine(
  inventory: FlyInventory,
  input: { app: string; machineId: string; feature?: FlyFeature },
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

export function selectTerminalTarget(
  inventory: FlyInventory,
  input: { app: string; machineId: string; feature?: FlyFeature },
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
