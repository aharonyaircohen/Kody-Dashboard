/**
 * @fileType library
 * @domain runner
 * @pattern fly-inventory-server
 *
 * Server-only inventory helpers that need request auth and state-repo access.
 */
import "server-only";

import type { NextRequest } from "next/server";

import { resolveBrainService } from "@dashboard/lib/brain/service-resolver";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
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

export async function appendSavedBrainMachineToInventory(
  req: NextRequest,
  inventory: FlyInventory,
): Promise<boolean> {
  const ctx = await resolveFlyContext(req);
  if (!ctx.ok || !ctx.context.flyToken) return false;

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );
  try {
    const brain = await resolveBrainService({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      githubToken: ctx.context.githubToken,
      orgSlug: ctx.context.flyOrgSlug,
      defaultRegion: ctx.context.flyDefaultRegion,
    });
    const app = brain.app;
    if (inventory.machines.some((m) => m.app === app)) return false;
    if (!brain.machine) return false;
    inventory.machines.push(brain.machine);
    return true;
  } catch (err) {
    logger.warn(
      { err, owner: ctx.context.owner },
      "fly-inventory: saved Brain machine lookup failed",
    );
    return false;
  } finally {
    clearGitHubContext();
  }
}
