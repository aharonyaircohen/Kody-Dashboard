/**
 * @fileType plugin
 * @domain infrastructure
 * @pattern fly-server-provider
 * @ai-summary Fly adapter for Kody servers: warm-pool claim first, then
 *   one-shot runner machine spawn. Vendor mechanics stay in this plugin.
 */

import type { ServerProvider } from "@dashboard/lib/infrastructure/contracts";
import { logger } from "@dashboard/lib/logger";
import { spawnRunner, type SpawnRunnerInput } from "@dashboard/lib/runners/fly";
import {
  resolveFlyContext,
  type FlyContext,
} from "@dashboard/lib/runners/fly-context";
import {
  type ClaimOrRunServerOptions,
  type ClaimOrRunServerResult,
} from "@dashboard/lib/runners/server-run";
import { claimFromPool } from "@dashboard/lib/runners/pool-client";

export type FlyServerProvider = ServerProvider<
  FlyContext,
  SpawnRunnerInput,
  Awaited<ReturnType<typeof spawnRunner>>,
  ClaimOrRunServerOptions,
  ClaimOrRunServerResult
>;

export const flyServerProvider: FlyServerProvider = {
  id: "fly",
  area: "servers",
  capabilities: new Set([
    "run-work",
    "claim-warm-runner",
    "wake",
    "destroy",
    "inventory",
  ]),
  async resolveContext(input) {
    return resolveFlyContext(
      (input as { request: Parameters<typeof resolveFlyContext>[0] }).request,
      (input as { options?: Parameters<typeof resolveFlyContext>[1] }).options,
    );
  },
  isAvailable(ctx) {
    return !!ctx.flyToken;
  },
  run(input) {
    return spawnRunner(input);
  },
  async claimOrRun(ctx, opts) {
    const { owner, repo, githubToken, allSecrets, flyToken, perfTier } = ctx;

    const claim = await claimFromPool({
      jobId: opts.taskId,
      repo: `${owner}/${repo}`,
      runRequest: opts.runRequest,
      ...(opts.idleExitMs ? { idleExitMs: opts.idleExitMs } : {}),
      ...(opts.hardCapMs ? { hardCapMs: opts.hardCapMs } : {}),
      dashboardUrl: opts.dashboardUrl,
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
      ref: opts.ref,
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
      "fly: pool miss - spawning fresh runner",
    );

    const { machineId } = await spawnRunner({
      repo: `${owner}/${repo}`,
      githubToken,
      runRequest: opts.runRequest,
      dashboardUrl: opts.dashboardUrl,
      ...(opts.idleExitMs ? { idleExitMs: opts.idleExitMs } : {}),
      ...(opts.hardCapMs ? { hardCapMs: opts.hardCapMs } : {}),
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
      ref: opts.ref,
      allSecrets,
      flyToken,
      perfTier,
    });
    return { runner: "fly", machineId };
  },
};
