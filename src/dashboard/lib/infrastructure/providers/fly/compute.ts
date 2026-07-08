/**
 * @fileType library
 * @domain infrastructure
 * @pattern fly-compute-provider
 * @ai-summary Fly adapter for Kody compute: warm-pool claim first, then
 *   one-shot runner machine spawn. Keeps Fly mechanics behind ComputeProvider.
 */

import type { ComputeProvider } from "@dashboard/lib/infrastructure/contracts";
import { logger } from "@dashboard/lib/logger";
import { claimFromPool } from "@dashboard/lib/runners/pool-client";
import { spawnRunner, type SpawnRunnerInput } from "@dashboard/lib/runners/fly";
import type { FlyContext } from "@dashboard/lib/runners/fly-context";
import type {
  ClaimOrSpawnOpts,
  ClaimOrSpawnResult,
} from "@dashboard/lib/runners/fly-run";

export type FlyComputeProvider = ComputeProvider<
  FlyContext,
  SpawnRunnerInput,
  Awaited<ReturnType<typeof spawnRunner>>,
  ClaimOrSpawnOpts,
  ClaimOrSpawnResult
>;

export const flyComputeProvider: FlyComputeProvider = {
  id: "fly",
  area: "compute",
  capabilities: new Set([
    "run-work",
    "claim-warm-runner",
    "wake",
    "destroy",
    "inventory",
  ]),
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
      ...(opts.ref ? { ref: opts.ref } : {}),
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
      runRequest: opts.runRequest,
      dashboardUrl: opts.dashboardUrl,
      ...(opts.idleExitMs ? { idleExitMs: opts.idleExitMs } : {}),
      ...(opts.hardCapMs ? { hardCapMs: opts.hardCapMs } : {}),
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
      ...(opts.ref ? { ref: opts.ref } : {}),
      allSecrets,
      flyToken,
      perfTier,
    });
    return { runner: "fly", machineId };
  },
};
