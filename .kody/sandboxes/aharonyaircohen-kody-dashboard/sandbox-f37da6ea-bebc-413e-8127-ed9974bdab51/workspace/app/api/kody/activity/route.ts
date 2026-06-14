/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern activity-api
 * @ai-summary GET /api/kody/activity — engine run health for the connected
 *   repo. Reads kody.yml workflow runs via the already-cached
 *   `fetchWorkflowRuns` (ETag/304-backed, shared with task-matching) and
 *   folds them into the Activity snapshot. No extra GitHub budget vs. the
 *   existing polled endpoints (CLAUDE.md rate-limit rules).
 */
import { NextRequest, NextResponse } from "next/server";
import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  fetchWorkflowRuns,
  fetchIssues,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { buildActivitySnapshot } from "@dashboard/lib/activity/snapshot";
import {
  mapRunActions,
  mapRunIssueNumbers,
} from "@dashboard/lib/activity/action";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    // 100 keeps the queue-depth / flood signals accurate without a
    // second page; this hits the same cached+ETag path as task-matching.
    // Both calls hit the shared cached+ETag path (same as task-matching);
    // the issue list is what carries the engine's kody:* action label, so
    // joining run→issue→action costs no per-issue requests.
    const [runs, issues] = await Promise.all([
      fetchWorkflowRuns({ perPage: 100 }),
      fetchIssues({ state: "open", perPage: 100 }),
    ]);
    const runActions = mapRunActions(runs, issues);
    const runIssues = mapRunIssueNumbers(runs, issues);
    return NextResponse.json(
      buildActivitySnapshot(runs, Date.now(), runActions, runIssues),
    );
  } catch (error: unknown) {
    return handleKodyApiError(error, "activity");
  } finally {
    clearGitHubContext();
  }
}
