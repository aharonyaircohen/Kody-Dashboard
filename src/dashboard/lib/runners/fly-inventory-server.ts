/**
 * @fileType library
 * @domain runner
 * @pattern fly-inventory-server
 *
 * Server-only inventory helpers that need request auth and state-repo access.
 */
import "server-only";

import type { NextRequest } from "next/server";

import { readBrainApp } from "@dashboard/lib/brain/store";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { listMachines } from "@dashboard/lib/previews/fly-previews";
import { brainAppName } from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import {
  rowsForFlyApp,
  type FlyInventory,
} from "@dashboard/lib/runners/fly-inventory";

export function emptyFlyInventory(): FlyInventory {
  return { machines: [], running: 0, total: 0 };
}

export function refreshFlyInventoryCounts(
  inventory: FlyInventory,
): FlyInventory {
  return {
    machines: inventory.machines,
    running: inventory.machines.filter(
      (m) =>
        m.state !== "suspended" &&
        m.state !== "stopped" &&
        m.state !== "destroyed",
    ).length,
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
    const stored = await readBrainApp(
      ctx.context.account,
      ctx.context.githubToken,
    ).catch(() => null);
    const app = stored?.appName ?? brainAppName(ctx.context.account);
    if (inventory.machines.some((m) => m.app === app)) return false;

    const machines = await listMachines(app, {
      token: ctx.context.flyToken,
      orgSlug: stored?.orgSlug ?? "personal",
      defaultRegion: "fra",
    });
    if (machines.length === 0) return false;

    inventory.machines.push(
      ...rowsForFlyApp(app, machines, Date.now(), {
        feature: "brain",
        label: app,
      }),
    );
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
