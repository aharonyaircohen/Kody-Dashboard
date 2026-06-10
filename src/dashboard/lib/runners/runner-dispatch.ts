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
  runner: "fly";
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
