/**
 * @fileType utility
 * @domain runners
 * @pattern runner-dispatch-orchestrator
 * @ai-summary Runs a job on GitHub Actions by default, falling back to the server provider in
 *   two cases: PROACTIVE (GitHub is unhealthy before we even try — degraded
 *   status or a full queue) and REACTIVE (the GitHub dispatch call itself
 *   throws). All side effects are injected so the decision flow is
 *   unit-testable without any network. Pairs the live probe with the pure
 *   `chooseRunner`.
 */
import type { GitHubActionsHealth } from "./github-health";
import { chooseRunner, type RunnerChoice } from "./runner-router";

export interface ServerRunResult {
  runner: "pool" | "fly";
  machineId: string;
}

export interface DispatchDeps {
  /** Probe GitHub Actions health (status + queue depth). */
  checkHealth: () => Promise<GitHubActionsHealth>;
  /** Whether a server-provider fallback is possible. */
  serverAvailable: boolean;
  /** Fire the GitHub workflow dispatch. Throws on API failure. */
  dispatchGitHub: () => Promise<void>;
  /** Run the job on the installed server provider. */
  runServer: () => Promise<ServerRunResult>;
}

export interface DispatchOutcome {
  runner: RunnerChoice;
  reason: string;
  /** Present when the job actually ran on the server provider. */
  serverResult?: ServerRunResult;
  /** True when the server provider was used only because GitHub dispatch threw. */
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
  const decision = chooseRunner({
    health,
    serverAvailable: deps.serverAvailable,
  });

  if (decision.runner === "server") {
    const serverResult = await deps.runServer();
    return { runner: "server", reason: decision.reason, serverResult };
  }

  try {
    await deps.dispatchGitHub();
    return { runner: "github", reason: decision.reason };
  } catch (err) {
    if (!deps.serverAvailable) throw err;
    const serverResult = await deps.runServer();
    return {
      runner: "server",
      reason: `github dispatch failed; server fallback: ${
        err instanceof Error ? err.message : String(err)
      }`,
      serverResult,
      fellBackOnError: true,
    };
  }
}
