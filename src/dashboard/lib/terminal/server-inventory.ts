/**
 * @fileType library
 * @domain terminal
 * @pattern terminal-inventory-authority
 *
 * Server-only helpers for choosing the Fly authority used by terminal routes.
 * General terminals use the repo Fly inventory. Brain terminals use the saved
 * Brain service when it is the requested target, because it may live under a
 * different Fly token or org than the repo default.
 */
import "server-only";

import type { NextRequest } from "next/server";

import type { FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import {
  listFlyInventory,
  FlyInventory,
  FlyMachineRow,
} from "@dashboard/lib/runners/fly-inventory";
import {
  applySavedBrainMachineToInventory,
  emptyFlyInventory,
  refreshFlyInventoryCounts,
  resolveSavedBrainServiceForRequest,
  type SavedBrainServiceForRequest,
} from "@dashboard/lib/runners/fly-inventory-server";
import type { FlyContext } from "@dashboard/lib/runners/fly-context";

export interface TerminalInventoryRequestTarget {
  brainRequested?: boolean;
  app?: string;
  machineId?: string;
}

export interface TerminalInventoryAuthority {
  inventory: FlyInventory;
  savedBrain: SavedBrainServiceForRequest | null;
}

export function terminalTargetFlyConfig(
  cfg: FlyPreviewConfig,
  orgSlug: string | undefined,
): FlyPreviewConfig {
  return orgSlug && orgSlug !== cfg.orgSlug ? { ...cfg, orgSlug } : cfg;
}

export function terminalFlyConfigForMachine(
  cfg: FlyPreviewConfig,
  machine: FlyMachineRow,
  savedBrain: SavedBrainServiceForRequest | null,
): FlyPreviewConfig {
  const savedBrainMachine = savedBrain?.brain.machine;
  const usesSavedBrainToken =
    machine.feature === "brain" &&
    savedBrain &&
    (savedBrainMachine?.app === machine.app ||
      savedBrain.brain.stored?.appName === machine.app ||
      savedBrain.brain.app === machine.app);
  const baseCfg = usesSavedBrainToken
    ? { ...cfg, token: savedBrain.flyToken }
    : cfg;
  return terminalTargetFlyConfig(baseCfg, machine.orgSlug);
}

export function terminalBridgeConfigCandidates(
  targetCfg: FlyPreviewConfig,
): FlyPreviewConfig[] {
  const seen = new Set([targetCfg.token]);
  const candidates = [targetCfg];
  for (const token of [
    process.env.FLY_API_TOKEN?.trim(),
    process.env.FLY_IO_TOKEN?.trim(),
  ]) {
    if (!token || seen.has(token)) continue;
    seen.add(token);
    candidates.push({ ...targetCfg, token });
  }
  return candidates;
}

function savedBrainTargetsRequest(
  savedBrain: SavedBrainServiceForRequest | null,
  target: TerminalInventoryRequestTarget,
): boolean {
  if (!savedBrain?.brain.machine) return false;
  if (target.brainRequested) return true;
  const app = target.app?.trim();
  const machineId = target.machineId?.trim();
  if (!app && !machineId) return false;
  return (
    app === savedBrain.brain.app ||
    app === savedBrain.brain.stored?.appName ||
    app === savedBrain.brain.machine.app ||
    machineId === savedBrain.brain.machine.machineId
  );
}

function savedBrainInventory(
  savedBrain: SavedBrainServiceForRequest,
): FlyInventory {
  const inventory = emptyFlyInventory();
  applySavedBrainMachineToInventory(inventory, savedBrain.brain);
  return refreshFlyInventoryCounts(inventory);
}

export async function loadTerminalInventoryAuthority(
  req: NextRequest,
  cfg: FlyPreviewConfig,
  target: TerminalInventoryRequestTarget,
  context?: FlyContext,
): Promise<TerminalInventoryAuthority> {
  const savedBrain = await resolveSavedBrainServiceForRequest(req, context);
  if (savedBrainTargetsRequest(savedBrain, target)) {
    return {
      inventory: savedBrainInventory(savedBrain!),
      savedBrain,
    };
  }
  if (target.brainRequested && !target.app && !target.machineId) {
    return {
      inventory: emptyFlyInventory(),
      savedBrain,
    };
  }

  let inventory: FlyInventory;
  try {
    inventory = await listFlyInventory(cfg);
  } catch (err) {
    if (savedBrainTargetsRequest(savedBrain, target)) {
      return {
        inventory: savedBrainInventory(savedBrain!),
        savedBrain,
      };
    }
    throw err;
  }

  if (savedBrain) {
    applySavedBrainMachineToInventory(inventory, savedBrain.brain);
    inventory = refreshFlyInventoryCounts(inventory);
  }

  return { inventory, savedBrain };
}
