/**
 * @fileType use-case
 * @domain brain
 * @pattern brain-terminal-connect
 *
 * Pure decision layer for connecting a terminal to the current Brain server.
 * Image selection drift is a Brain warning, not a terminal blocker.
 */

import type { FlyInventory } from "@dashboard/lib/runners/fly-inventory";
import {
  resolveBrainTerminalTargetInput,
  type TerminalTargetInput,
} from "@dashboard/lib/terminal/session";

import {
  brainRuntimeDrift,
  type BrainRuntimeDrift,
} from "./runtime-authority";
import type { BrainRuntimeView } from "./runtime-manager";

export interface BrainTerminalWarning {
  code: BrainRuntimeDrift["code"];
  message: string;
  desiredImageRef?: string;
  runningImageRef?: string | null;
  machineImageRef?: string | null;
}

export interface BrainTerminalConnectDecision {
  targetInput: TerminalTargetInput | null;
  warnings: BrainTerminalWarning[];
}

function warningFromDrift(
  drift: BrainRuntimeDrift | null,
): BrainTerminalWarning | null {
  if (!drift) return null;
  return {
    code: drift.code,
    message: drift.message,
    desiredImageRef: drift.desiredImageRef,
    runningImageRef: drift.runningImageRef,
    machineImageRef: drift.machineImageRef,
  };
}

export function resolveBrainTerminalConnect(input: {
  runtime: BrainRuntimeView;
  inventory: FlyInventory;
  requestedTarget: TerminalTargetInput | null;
}): BrainTerminalConnectDecision {
  const warning = warningFromDrift(brainRuntimeDrift(input.runtime, null));
  const targetInput =
    input.runtime.runningApp && input.runtime.runningMachineId
      ? {
          app: input.runtime.runningApp,
          machineId: input.runtime.runningMachineId,
          feature: "brain" as const,
        }
      : resolveBrainTerminalTargetInput(
          input.inventory,
          input.requestedTarget,
        );

  return {
    targetInput,
    warnings: warning ? [warning] : [],
  };
}
