/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern managed-goal-run-logs-api
 * @ai-summary GET /api/kody/goals/managed/:id/runs reads recent managed-goal
 *   JSONL run logs from the configured Kody state repo.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";

import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { managedGoalPath } from "@dashboard/lib/managed-goals";
import { listManagedGoalRunLogs } from "@dashboard/lib/managed-goal-run-logs";

function parseLimit(req: NextRequest): number {
  const raw = req.nextUrl.searchParams.get("limit");
  const parsed = raw ? Number.parseInt(raw, 10) : 8;
  return Number.isFinite(parsed) ? parsed : 8;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const { id } = await params;
  try {
    managedGoalPath(id);
  } catch {
    return NextResponse.json({ error: "invalid_goal_id" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_user_token" }, { status: 401 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );
  try {
    const payload = await listManagedGoalRunLogs({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      goalId: id,
      limit: parseLimit(req),
    });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "failed_to_read_managed_goal_runs",
        message: err?.message ?? "Failed to read managed goal runs",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
