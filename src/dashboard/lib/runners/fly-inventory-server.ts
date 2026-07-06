/**
 * @fileType library
 * @domain runner
 * @pattern fly-inventory-server
 *
 * Server-only inventory helpers that need request auth and state-repo access.
 */
import "server-only";

import { createHash } from "node:crypto";
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
import type { FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import {
  resolveFlyContext,
  type FlyContext,
} from "@dashboard/lib/runners/fly-context";
import {
  listFlyInventory,
  type FlyInventory,
} from "@dashboard/lib/runners/fly-inventory";
import { isFlyMachineRunning } from "@dashboard/lib/runners/fly-machine-model";
import { createServerTtlCache } from "@dashboard/lib/server-ttl-cache";

const FLY_INVENTORY_TTL_MS = 15_000;
const flyInventoryCache = createServerTtlCache<FlyInventory>({
  ttlMs: FLY_INVENTORY_TTL_MS,
});

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

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function flyInventoryKey(cfg: FlyPreviewConfig): string {
  return `${cfg.orgSlug ?? ""}:${tokenKey(cfg.token)}`;
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

export async function listFlyInventoryCached(
  cfg: FlyPreviewConfig,
): Promise<FlyInventory> {
  return flyInventoryCache.get(flyInventoryKey(cfg), () =>
    listFlyInventory(cfg),
  );
}

export async function resolveSavedBrainServiceForRequest(
  req: NextRequest,
  context?: FlyContext,
): Promise<SavedBrainServiceForRequest | null> {
  const ctx = context
    ? { ok: true as const, context }
    : await resolveFlyContext(req);
  if (!ctx.ok) return null;
  const resolvedContext = ctx.context;
  const initialFlyToken = resolvedContext.flyToken;
  if (!initialFlyToken) return null;

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
        account: resolvedContext.account,
        githubToken: resolvedContext.githubToken,
        orgSlug: resolvedContext.flyOrgSlug,
        defaultRegion: resolvedContext.flyDefaultRegion,
      });
    let flyToken = initialFlyToken;
    let brain = await resolveBrain(flyToken);
    const fallbackToken = envFlyTokenFallback(initialFlyToken);
    if (brain.stored && !brain.machine && fallbackToken) {
      const fallbackBrain = await resolveBrain(fallbackToken);
      if (fallbackBrain.machine) {
        brain = fallbackBrain;
        flyToken = fallbackToken;
      }
    }
    return { brain, context: resolvedContext, flyToken };
  } catch (err) {
    logger.warn(
      { err, owner: resolvedContext.owner },
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
  context?: FlyContext,
): Promise<boolean> {
  const resolved = await resolveSavedBrainServiceForRequest(req, context);
  return resolved
    ? applySavedBrainMachineToInventory(inventory, resolved.brain)
    : false;
}
