/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern health-api
 * @ai-summary GET /api/kody/health — the "can runs even start, and are their
 *   dependencies healthy?" report for the connected repo. Runs the upstream
 *   probes (GitHub Actions status, token rate-limit standing, webhook
 *   deliveries, vault, engine model key, recent runs, dispatch failures) and
 *   returns a worst-level rollup for the Activity Health banner.
 *
 *   Budget: the workflow-run read reuses the shared cached+ETag path (same as
 *   /activity), config + vault reads are 60s-cached, the rate-limit probe is a
 *   free endpoint, and webhook deliveries are 5-min cached — so polling this
 *   adds effectively nothing to the GitHub budget (CLAUDE.md rate-limit rules).
 */
import { NextRequest, NextResponse } from "next/server";
import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  fetchWorkflowRuns,
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { isVaultConfigured } from "@dashboard/lib/vault/crypto";
import { getSecret } from "@dashboard/lib/vault/get-secret";
import { buildHealthReport } from "@dashboard/lib/health/report";
import { keyNameForModelSpec } from "@dashboard/lib/health/model-health";
import type { RunLite } from "@dashboard/lib/health/runs-health";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const octokit = getOctokit();
    const owner = headerAuth?.owner ?? "";
    const repo = headerAuth?.repo ?? "";

    // Shared cached+ETag workflow-run read — same path as /activity.
    const runs = await fetchWorkflowRuns({ perPage: 50 });
    const runLite: RunLite[] = runs.map((r) => ({
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
    }));

    // Engine model (cached config) → derive its provider key name → check it.
    const { config } = await getEngineConfig(octokit, owner, repo);
    const modelSpec = config.agent?.model ?? null;
    const resolved = modelSpec ? keyNameForModelSpec(modelSpec) : null;
    const hasModelKey = resolved
      ? Boolean(await getSecret(resolved.keyName, { req }))
      : false;

    // Vault standing (the webhook background-write dependency).
    const vaultConfigured = isVaultConfigured();
    const hasVaultGithubToken = vaultConfigured
      ? Boolean(await getSecret("GITHUB_TOKEN", { req, vaultOnly: true }))
      : false;

    const report = await buildHealthReport({
      octokit,
      owner,
      repo,
      token: headerAuth?.token ?? null,
      runs: runLite,
      modelSpec,
      hasModelKey,
      vaultConfigured,
      hasVaultGithubToken,
      dashboardUrlHint: process.env.NEXT_PUBLIC_SERVER_URL || undefined,
    });

    return NextResponse.json(report);
  } catch (error: unknown) {
    return handleKodyApiError(error, "health");
  } finally {
    clearGitHubContext();
  }
}
