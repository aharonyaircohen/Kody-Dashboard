/**
 * # runners/
 *
 * What this folder is: the GitHub↔Fly runner decision + the Fly execution path
 * the dashboard uses to run kody jobs (chat sessions, run-executable, fly-live).
 * GitHub Actions is the base runtime (free on public repos); Fly is a
 * per-repo fallback + per-user persistent surface, used only when GitHub
 * won't take the job.
 *
 * Entry points (caller → here):
 *   - `dispatchRun` (runner-dispatch.ts) — "decide + run" orchestrator. The
 *     route-side entry. Injects the health probe + GitHub dispatch + Fly
 *     runFly, pairs the live probe with the pure `chooseRunner` below.
 *   - `claimOrSpawnFly` (fly-run.ts) — "claim a warm pool machine, else
 *     spawn a fresh one." Used by both the start-fly route and the
 *     GitHub→Fly fallback path inside `dispatchRun` so they can't drift.
 *
 * GitHub→Fly fallback contract (the seam this folder owns):
 *   1. Probe GitHub health (`github-health.ts` — both probes fail OPEN so a
 *      status-page hiccup or transient list error never wrongly diverts every
 *      job to Fly).
 *   2. If healthy → dispatch on GitHub Actions.
 *   3. If unhealthy AND a Fly token exists for the repo → run on Fly.
 *   4. If unhealthy AND no Fly token → stay on GitHub anyway. The dashboard
 *      never silently fails — there's always somewhere to send the job; the
 *      worst case is "GitHub is slow", not "no runner".
 *   5. If the GitHub dispatch call itself throws → fall back to Fly (only
 *      when a Fly token is configured; otherwise rethrow).
 *
 * Warm-pool boundary:
 *   - The pool is an *accelerator*, not a hard dependency. `claimFromPool`
 *     (`pool-client.ts`) NEVER throws — any failure (no master key, pool
 *     unreachable, empty pool → 503) returns `{ ok: false, reason }` and the
 *     caller falls through to `spawnRunner` (`fly.ts`).
 *   - The pool API key is derived, never stored: both sides compute
 *     HKDF(KODY_MASTER_KEY, "kody-pool-api:v1") — see `pool-keys.ts`. The
 *     engine's `kody2/src/pool/keys.ts` derives the IDENTICAL value. No
 *     secret over the wire, no shared lookup.
 *
 * Fly token plumbing:
 *   - Every spawner route goes through `resolveFlyContext` (`fly-context.ts`),
 *     which is the only place a Fly token is read (vault → env fallback).
 *     Per-repo billing, never `process.env` from a route handler.
 *   - `fly.ts` (one-shot, auto_destroy) and `brain-fly.ts` (persistent,
 *     autostop=suspend) are intentionally separate — different lifecycles,
 *     they share only the `flyToken` plumbing.
 *
 * Fly inventory / activity / cost (operator UI):
 *   `fly-inventory.ts`, `fly-activity.ts`, `fly-activity-store.ts`,
 *   `fly-rates.ts`, `fly-suspend-all.ts`, `litellm-fly.ts` — the read-side
 *   surface for the Runner page. They never mutate job routing.
 *
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
