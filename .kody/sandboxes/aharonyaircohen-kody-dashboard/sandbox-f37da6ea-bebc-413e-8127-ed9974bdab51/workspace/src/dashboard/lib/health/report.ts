/**
 * @fileType utility
 * @domain kody
 * @pattern health-report
 * @ai-summary Orchestrator: runs every health probe and folds the signals
 *   into one HealthReport (worst-level rollup, worst-first order). Each probe
 *   is self-contained and never throws, so one slow/broken probe can't sink
 *   the report. Next-coupled lookups (engine config, vault secret) are
 *   resolved by the route and passed in as primitives, keeping this module
 *   framework-free and unit-testable.
 */
import type { Octokit } from "@octokit/rest";
import type { HealthReport, HealthSignal } from "./types";
import { rollupLevel, orderSignals } from "./rollup";
import { probeGitHubActionsStatus } from "./github-status";
import { probeTokenHealth } from "./token-health";
import { probeWebhookHealth } from "./webhook-health";
import { buildRunsSignal, type RunLite } from "./runs-health";
import { buildModelSignal } from "./model-health";
import { buildVaultSignal } from "./vault-health";
import {
  buildDispatchSignal,
  recentDispatchFailures,
} from "./dispatch-failures";

export interface HealthReportInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  /** The request token, for the (free) rate-limit probe. */
  token: string | null;
  runs: RunLite[];
  /** Resolved by the route from kody.config.json `agent.model`. */
  modelSpec: string | null | undefined;
  /** Resolved by the route: does the model's provider key exist (vault/env)? */
  hasModelKey: boolean;
  /** Resolved by the route: KODY_MASTER_KEY present? */
  vaultConfigured: boolean;
  /** Resolved by the route: vault has a GITHUB_TOKEN secret? */
  hasVaultGithubToken: boolean;
  now?: number;
  dashboardUrlHint?: string;
}

export async function buildHealthReport(
  input: HealthReportInput,
): Promise<HealthReport> {
  const now = input.now ?? Date.now();

  // Async probes (network). Each already fails soft; allSettled guards anyway.
  const [actions, token, webhook] = await Promise.all([
    probeGitHubActionsStatus().catch(
      fallback("github-actions", "GitHub Actions"),
    ),
    probeTokenHealth(input.token).catch(fallback("token", "GitHub token")),
    probeWebhookHealth(
      input.octokit,
      input.owner,
      input.repo,
      input.dashboardUrlHint,
    ).catch(fallback("webhook", "GitHub webhook")),
  ]);

  // Pure/derived signals.
  const runs = buildRunsSignal(input.runs, now);
  const model = buildModelSignal({
    modelSpec: input.modelSpec,
    hasKey: input.hasModelKey,
  });
  const vault = buildVaultSignal({
    configured: input.vaultConfigured,
    hasGithubToken: input.hasVaultGithubToken,
  });
  const dispatch = buildDispatchSignal(recentDispatchFailures(now));

  const signals = orderSignals([
    actions,
    token,
    dispatch,
    runs,
    model,
    webhook,
    vault,
  ]);

  return {
    level: rollupLevel(signals),
    signals,
    checkedAt: new Date(now).toISOString(),
  };
}

/** Build a degraded fallback signal if a probe rejects unexpectedly. */
function fallback(id: string, label: string) {
  return (): HealthSignal => ({
    id,
    label,
    level: "degraded",
    detail: "Health check failed to run.",
  });
}
