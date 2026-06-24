/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern activity-run-logs-api
 * @ai-summary GET /api/kody/activity/run-logs — on-demand Activity tab that
 *   reads Kody run timeline events from GitHub Actions artifacts named
 *   kody-run-logs-<run_id>-<run_attempt>.
 */
import { NextRequest, NextResponse } from "next/server";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  fetchKodyRunLogArtifact,
  fetchWorkflowRuns,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { buildRunLogsSnapshot } from "@dashboard/lib/activity/run-logs";

function parseLimit(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  if (!Number.isFinite(raw)) return 20;
  return Math.max(1, Math.min(50, Math.floor(raw)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const runs = await fetchWorkflowRuns({ perPage: parseLimit(req) });
    const runLogs = await mapWithConcurrency(runs, 4, fetchKodyRunLogArtifact);
    return NextResponse.json(buildRunLogsSnapshot(runLogs));
  } catch (error: unknown) {
    return handleKodyApiError(error, "activity-run-logs");
  } finally {
    clearGitHubContext();
  }
}
