/**
 * @fileType utility
 * @domain runners
 * @pattern fly-claim-or-spawn
 * @ai-summary Shared "run this interactive session on Fly" core: claim a warm
 *   pool machine first, fall through to spawning a fresh one on any miss.
 *   Extracted so the start-fly route and the GitHub→Fly fallback in the start
 *   route share one path and can't drift. The caller is responsible for
 *   writing the session meta line BEFORE calling this.
 */
import { claimFromPool } from "./pool-client";
import { spawnRunner } from "./fly";
import type { FlyContext } from "./fly-context";
import { logger } from "@dashboard/lib/logger";

export interface ClaimOrSpawnOpts {
  /** Session / task id (jobId). */
  taskId: string;
  idleExitMs?: number;
  hardCapMs?: number;
  /** Pre-signed ingest URL with inline HMAC token; undefined → git-polling. */
  dashboardUrl?: string;
  /**
   * Thinking level (off|low|medium|high). Forwarded to both the warm
   * pool claim and the cold spawn. Engine reads REASONING_EFFORT env
   * var — empty/undefined means the engine uses its own default.
   */
  reasoningEffort?: string;
}

export interface ClaimOrSpawnResult {
  runner: "pool" | "fly";
  machineId: string;
}

/**
 * Claim a warm pool machine, else spawn a fresh one. Never decides whether
 * Fly *should* be used — that's the router's job; by the time we're here the
 * caller has already committed to Fly and resolved a FlyContext.
 */
export async function claimOrSpawnFly(
  ctx: FlyContext,
  opts: ClaimOrSpawnOpts,
): Promise<ClaimOrSpawnResult> {
  const { owner, repo, githubToken, allSecrets, flyToken, perfTier } = ctx;

  const claim = await claimFromPool({
    jobId: opts.taskId,
    repo: `${owner}/${repo}`,
    mode: "interactive",
    sessionId: opts.taskId,
    idleExitMs: opts.idleExitMs,
    hardCapMs: opts.hardCapMs,
    dashboardUrl: opts.dashboardUrl,
    ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
  });
  if (claim.ok) {
    logger.info(
      { taskId: opts.taskId, machineId: claim.machineId, owner, repo },
      "fly: claimed warm pool machine",
    );
    return { runner: "pool", machineId: claim.machineId };
  }

  logger.info(
    { taskId: opts.taskId, owner, repo, poolMiss: claim.reason },
    "fly: pool miss — spawning fresh runner",
  );

  const { machineId } = await spawnRunner({
    repo: `${owner}/${repo}`,
    githubToken,
    sessionId: opts.taskId,
    dashboardUrl: opts.dashboardUrl,
    idleExitMs: opts.idleExitMs,
    hardCapMs: opts.hardCapMs,
    ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
    allSecrets,
    flyToken,
    perfTier,
  });
  return { runner: "fly", machineId };
}
