/**
 * @fileType utility
 * @domain runners
 * @pattern fly-claim-or-spawn
 * @ai-summary Shared "run this target on Fly" core: claim a warm pool machine
 *   first, fall through to spawning a fresh one on any miss. Chat, issue,
 *   goal, and workflow callers all pass the same runRequest contract.
 */
import { flyComputeProvider } from "@dashboard/lib/infrastructure/providers/fly/compute";
import type { FlyContext } from "./fly-context";
import type { KodyRunRequest } from "./run-request";

export interface ClaimOrSpawnOpts {
  /** Task id / job id for logs, pool claims, and machine identity. */
  taskId: string;
  runRequest: KodyRunRequest;
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
  /** Git ref to clone. */
  ref?: string;
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
  return flyComputeProvider.claimOrRun!(ctx, opts);
}
