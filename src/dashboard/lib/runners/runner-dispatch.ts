/**
 * @file runners/ — folder map
 *
 * Owns "where does a Kody run execute" (GitHub Actions vs Fly Machines) and
 * the per-repo Fly surface (runners, warm pool, Brain, LiteLLM). Read
 * `docs/runners.md` for the long-form version; this header is the spine +
 * gotchas so an agent doesn't have to grep to find them.
 *
 * Entry point: `dispatchRun` below. The start routes call it with injected
 * `checkHealth` / `dispatchGitHub` / `runFly`, so the decision flow is
 * unit-testable without any network.
 *
 * Spine (the "where does this run?" decision):
 *   runner-dispatch.ts — this file, orchestrator: probe → choose → run,
 *                        with proactive + reactive Fly fallback
 *   runner-router.ts   — pure `chooseRunner`: github vs fly, no I/O,
 *                        exhaustively unit-testable
 *
 * Surfaces around the spine:
 *   Fly Machines REST  — fly.ts (one-shot spawn), fly-inventory.ts (list),
 *                        fly-suspend-all.ts (batch suspend), fly-rates.ts (cost)
 *   GitHub health      — github-health.ts (status page + queue, both fail-open)
 *   Pool + warm claim  — pool-keys.ts (derive), pool-client.ts (claim, never
 *                        throws), fly-run.ts (claim-or-spawn, shared)
 *   Fly spawn context  — fly-context.ts (vault + token + perf), fly-run.ts
 *   Brain / LiteLLM    — brain-fly.ts (persistent per-user app),
 *                        litellm-fly.ts (read-only status probe)
 *   Activity + cost    — fly-activity.ts, fly-activity-store.ts, fly-rates.ts
 *
 * Load-bearing gotchas (do not "fix" without re-reading docs/runners.md):
 *   - Fly token is resolved from the per-repo secrets vault
 *     (`FLY_API_TOKEN`), NEVER `process.env`. Billing is per repo, never
 *     per Vercel env — see `fly-context.ts` for the single-source-of-truth
 *     resolution. Adding an env-var fallback would leak one repo's spend
 *     onto another's runs.
 *   - GitHub → Fly fallback fires ONLY when GitHub is unhealthy AND a Fly
 *     token exists for the repo. With no token we stay on GitHub even if
 *     it's degraded — there is nowhere else to send the job. See the
 *     truth table in `runner-router.ts`.
 *   - `pool-keys.ts` derives `POOL_API_KEY` from `KODY_MASTER_KEY` via
 *     HKDF; the pool owner (kody-engine) derives the IDENTICAL value. The
 *     bearer is never stored or transmitted — both sides compute it.
 *     Rotation = bump `POOL_API_KEY_INFO` to `:v2` (both sides must move
 *     together or every pool claim 401s).
 */

/**
 * @fileType utility
 * @domain runners
 * @pattern runner-dispatch-orchestrator
 * @ai-summary Runs a job on GitHub Actions by default, falling back to Fly in
 *   two cases: PROACTIVE (GitHub is unhealthy before we even try — degraded
 *   status or a full queue) and REACTIVE (the GitHub dispatch call itself
 *   throws). All side effects are injected (checkHealth, dispatchGitHub,
 *   runFly) so the decision flow is unit-testable without any network. Pairs
 *   the live probe with the pure `chooseRunner`.
 */
import type { GitHubActionsHealth } from "./github-health";
import { chooseRunner, type RunnerChoice } from "./runner-router";

export interface FlyRunResult {
  runner: "pool" | "fly";
  machineId: string;
}

export interface DispatchDeps {
  /** Probe GitHub Actions health (status + queue depth). */
  checkHealth: () => Promise<GitHubActionsHealth>;
  /** Whether this repo has a Fly token configured (fallback is possible). */
  flyAvailable: boolean;
  /** Fire the GitHub workflow dispatch. Throws on API failure. */
  dispatchGitHub: () => Promise<void>;
  /** Run the job on Fly. */
  runFly: () => Promise<FlyRunResult>;
}

export interface DispatchOutcome {
  runner: RunnerChoice;
  reason: string;
  /** Present when the job actually ran on Fly. */
  flyResult?: FlyRunResult;
  /** True when Fly was used only because the GitHub dispatch threw. */
  fellBackOnError?: boolean;
}

/**
 * Decide + execute. Returns where the job landed and why. The only throw
 * path is: GitHub dispatch failed AND no Fly fallback is available — there's
 * genuinely nowhere left to run, so the caller surfaces the error.
 */
export async function dispatchRun(
  deps: DispatchDeps,
): Promise<DispatchOutcome> {
  const health = await deps.checkHealth();
  const decision = chooseRunner({ health, flyAvailable: deps.flyAvailable });

  if (decision.runner === "fly") {
    const flyResult = await deps.runFly();
    return { runner: "fly", reason: decision.reason, flyResult };
  }

  try {
    await deps.dispatchGitHub();
    return { runner: "github", reason: decision.reason };
  } catch (err) {
    if (!deps.flyAvailable) throw err;
    const flyResult = await deps.runFly();
    return {
      runner: "fly",
      reason: `github dispatch failed → fly fallback: ${
        err instanceof Error ? err.message : String(err)
      }`,
      flyResult,
      fellBackOnError: true,
    };
  }
}
