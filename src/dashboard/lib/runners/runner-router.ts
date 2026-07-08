/**
 * @fileType utility
 * @domain runners
 * @pattern runner-router
 * @ai-summary Pure decision: given GitHub Actions health and whether a server
 *   provider is available, pick where a job should run. GitHub is the base;
 *   the server provider is the fallback when GitHub is unhealthy and another
 *   runtime is available. No I/O, so it is exhaustively unit-testable.
 */
import type { GitHubActionsHealth } from "./github-health";

export type RunnerChoice = "github" | "server";

export interface RouteDecision {
  runner: RunnerChoice;
  reason: string;
}

/**
 * Decide the runner. Deterministic and side-effect-free — the live probe
 * (`checkGitHubActionsHealth`) and provider availability lookup happen in the
 * caller.
 */
export function chooseRunner(args: {
  health: GitHubActionsHealth;
  serverAvailable: boolean;
}): RouteDecision {
  const { health, serverAvailable } = args;

  if (health.healthy) {
    return { runner: "github", reason: `github base — ${health.reason}` };
  }
  if (serverAvailable) {
    return {
      runner: "server",
      reason: `github unhealthy; server fallback — ${health.reason}`,
    };
  }
  return {
    runner: "github",
    reason: `github unhealthy but no server provider available — staying on github — ${health.reason}`,
  };
}
