/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern pipeline-api
 * @ai-summary Returns the per-job check-run results for a workflow run.
 *   StageErrorDetail (a client component) used to import fetchCheckRunsForRun
 *   from github-client directly, which dragged server-only GitHub code into the
 *   browser bundle and never actually worked client-side (no token there).
 *   This route runs the fetch server-side where auth + the rate-limit cache
 *   live; the component fetches from here instead.
 */
import { NextRequest, NextResponse } from "next/server";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  fetchCheckRunsForRun,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const { runId: rawRunId } = await params;
  const runId = Number(rawRunId);
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json(
      { error: "invalid_run_id", message: "runId must be a positive integer." },
      { status: 400 },
    );
  }

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const checkRuns = await fetchCheckRunsForRun(runId);
    return NextResponse.json({ checkRuns });
  } catch (error: unknown) {
    return handleKodyApiError(error, "check-runs");
  } finally {
    clearGitHubContext();
  }
}
