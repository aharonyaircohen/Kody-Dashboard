/**
 * @fileType utility
 * @domain runners
 * @pattern runner-router
 * @ai-summary Pure decision: given GitHub Actions health and whether the repo
 *   has Fly configured, pick which runner a job should use. GitHub is the base
 *   (free on public repos); Fly is the fallback, used only when GitHub is
 *   unhealthy AND a Fly token exists for the repo. With no Fly token we stay on
 *   GitHub even when it's unhealthy — there's nowhere else to send the job. No
 *   I/O, so it's exhaustively unit-testable.
 */
import type { GitHubActionsHealth } from "./github-health";

export type RunnerChoice = "github" | "fly";

export interface RouteDecision {
  runner: RunnerChoice;
  reason: string;
}

/**
 * Decide the runner. Deterministic and side-effect-free — the live probe
 * (`checkGitHubActionsHealth`) and Fly-token lookup happen in the caller.
 */
export function chooseRunner(args: {
  health: GitHubActionsHealth;
  flyAvailable: boolean;
}): RouteDecision {
  const { health, flyAvailable } = args;

  if (health.healthy) {
    return { runner: "github", reason: `github base — ${health.reason}` };
  }
  if (flyAvailable) {
    return {
      runner: "fly",
      reason: `github unhealthy → fly fallback — ${health.reason}`,
    };
  }
  return {
    runner: "github",
    reason: `github unhealthy but no fly token — staying on github — ${health.reason}`,
  };
}
