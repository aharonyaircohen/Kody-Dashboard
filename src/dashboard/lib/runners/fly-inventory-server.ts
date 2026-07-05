/**
 * @fileType library
 * @domain runner
 * @pattern fly-inventory-server
 *
 * Server-only inventory helpers that need request auth and state-repo access.
 */
import "server-only";

import type { NextRequest } from "next/server";

import {
  resolveBrainService,
  type BrainServiceResolution,
} from "@dashboard/lib/brain/service-resolver";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import {
  resolveFlyContext,
  type FlyContext,
} from "@dashboard/lib/runners/fly-context";
import type { FlyInventory } from "@dashboard/lib/runners/fly-inventory";
import { isFlyMachineRunning } from "@dashboard/lib/runners/fly-machine-model";

export function emptyFlyInventory(): FlyInventory {
  return { machines: [], running: 0, total: 0 };
}

export function refreshFlyInventoryCounts(
  inventory: FlyInventory,
): FlyInventory {
  return {
    machines: inventory.machines,
    running: inventory.machines.filter((m) => isFlyMachineRunning(m.state))
      .length,
    total: inventory.machines.length,
  };
}

function envFlyTokenFallback(primaryToken: string): string | undefined {
  const token =
    process.env.FLY_API_TOKEN?.trim() || process.env.FLY_IO_TOKEN?.trim();
  return token && token !== primaryToken ? token : undefined;
}

export interface SavedBrainServiceForRequest {
  brain: BrainServiceResolution;
  context: FlyContext;
  flyToken: string;
}

export function applySavedBrainMachineToInventory(
  inventory: FlyInventory,
  brain: BrainServiceResolution,
): boolean {
  const app = brain.app;
  if (!brain.machine) {
    if (brain.stored) {
      inventory.machines = inventory.machines.filter(
        (m) => m.feature !== "brain" && m.app !== app,
      );
    }
    return false;
  }
  inventory.machines = inventory.machines.filter(
    (m) => m.feature !== "brain" && m.app !== app,
  );
  inventory.machines.push({ ...brain.machine, orgSlug: brain.orgSlug });
  return true;
}

export async function resolveSavedBrainServiceForRequest(
  req: NextRequest,
): Promise<SavedBrainServiceForRequest | null> {
  const ctx = await resolveFlyContext(req);
  if (!ctx.ok || !ctx.context.flyToken) return null;

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );
  try {
    const resolveBrain = (flyToken: string) =>
      resolveBrainService({
        flyToken,
        account: ctx.context.account,
        githubToken: ctx.context.githubToken,
        orgSlug: ctx.context.flyOrgSlug,
        defaultRegion: ctx.context.flyDefaultRegion,
      });
    let flyToken = ctx.context.flyToken;
    let brain = await resolveBrain(flyToken);
    const fallbackToken = envFlyTokenFallback(ctx.context.flyToken);
    if (brain.stored && !brain.machine && fallbackToken) {
      const fallbackBrain = await resolveBrain(fallbackToken);
      if (fallbackBrain.machine) {
        brain = fallbackBrain;
        flyToken = fallbackToken;
      }
    }
    return { brain, context: ctx.context, flyToken };
  } catch (err) {
    logger.warn(
      { err, owner: ctx.context.owner },
      "fly-inventory: saved Brain machine lookup failed",
    );
    return null;
  } finally {
    clearGitHubContext();
  }
}

export async function appendSavedBrainMachineToInventory(
  req: NextRequest,
  inventory: FlyInventory,
): Promise<boolean> {
  const resolved = await resolveSavedBrainServiceForRequest(req);
  return resolved
    ? applySavedBrainMachineToInventory(inventory, resolved.brain)
    : false;
}
