/**
 * @fileType model
 * @domain runner
 * @pattern fly-machine-model
 *
 * Shared dashboard model for Fly runtime machines. A machine is the runtime
 * object; `feature` names the service that owns it.
 */

export type FlyFeature =
  | "preview"
  | "preview-base"
  | "runner"
  | "brain"
  | "builder"
  | "other";

export interface FlyMachineRow {
  feature: FlyFeature;
  app: string;
  machineId: string;
  name?: string;
  state: string;
  region: string;
  /** Human label, e.g. "PR #2350", "branch", "kody-runner". */
  label: string;
  /** "shared 2x · 4 GB" or "—" when size is unknown. */
  sizeLabel: string;
  /** Raw guest sizing — consumed by the activity snapshot store / cost estimate. */
  guest?: { cpuKind?: string; cpus?: number; memoryMb?: number };
  createdAt?: string;
  ageDays?: number;
}

export interface FlyInventory {
  machines: FlyMachineRow[];
  /** Count in a live (non-suspended/stopped) state — the ones costing CPU. */
  running: number;
  /** Total machines across all features. */
  total: number;
}

export const FLY_FEATURE_TITLE: Record<FlyFeature, string> = {
  preview: "Previews",
  runner: "Fly runners",
  brain: "Brain server",
  builder: "Builders",
  "preview-base": "Preview base images",
  other: "Other",
};

export function flyFeatureLabel(feature: FlyFeature): string {
  return FLY_FEATURE_TITLE[feature];
}

export function flyMachineTerminalLabel(machine: FlyMachineRow): string {
  return `${flyFeatureLabel(machine.feature)}: ${machine.label}`;
}

export function isFlyMachineRunning(state: string): boolean {
  return state !== "suspended" && state !== "stopped" && state !== "destroyed";
}

export function isFlyTerminalCapable(feature: FlyFeature): boolean {
  return feature === "brain";
}
