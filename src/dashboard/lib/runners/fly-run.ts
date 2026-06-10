/**
 * @fileType utility
 * @domain runners
 * @pattern fly-spawn
 * @ai-summary Shared "run this interactive session on Fly" core. Extracted so
 *   the start-fly route and the GitHub→Fly fallback in the start route share
 *   one path and can't drift. The caller is responsible for writing the
 *   session meta line BEFORE calling this.
 */
import { spawnRunner } from "./fly";
import type { FlyContext } from "./fly-context";
import { logger } from "@dashboard/lib/logger";

export interface SpawnFlyRunnerOpts {
  /** Session / task id (jobId). */
  taskId: string;
  idleExitMs?: number;
  hardCapMs?: number;
  /** Pre-signed ingest URL with inline HMAC token; undefined → git-polling. */
  dashboardUrl?: string;
}

export interface SpawnFlyRunnerResult {
  runner: "fly";
  machineId: string;
}

/**
 * Spawn a fresh Fly runner. Never decides whether Fly *should* be used —
 * that's the router's job; by the time we're here the caller has already
 * committed to Fly and resolved a FlyContext.
 */
export async function spawnFlyRunner(
  ctx: FlyContext,
  opts: SpawnFlyRunnerOpts,
): Promise<SpawnFlyRunnerResult> {
  const { owner, repo, githubToken, allSecrets, flyToken, perfTier } = ctx;

  const { machineId } = await spawnRunner({
    repo: `${owner}/${repo}`,
    githubToken,
    sessionId: opts.taskId,
    dashboardUrl: opts.dashboardUrl,
    idleExitMs: opts.idleExitMs,
    hardCapMs: opts.hardCapMs,
    allSecrets,
    flyToken,
    perfTier,
  });
  logger.info(
    { taskId: opts.taskId, machineId, owner, repo },
    "fly: spawned fresh runner",
  );
  return { runner: "fly", machineId };
}
