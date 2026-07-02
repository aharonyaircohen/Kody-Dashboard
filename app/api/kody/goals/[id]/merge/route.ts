/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goal-runtime-state
 * @ai-summary Manual "Merge goal" action. A goal whose tasks are all done
 *   is parked by the engine at `state="awaiting-merge"` (no auto-merge).
 *   This endpoint is the only thing that advances it: it flips the goal
 *   back to `state="active"` and sets the one-shot `mergeApproved` flag,
 *   then dispatches `kody.yml` so the engine's UNCHANGED finalize runs
 *   once (retarget leaf → squash-merge → close stack → state="done").
 *   Separate from the state route on purpose: that route's contract is
 *   "start/pause the runner"; this one carries the merge intent.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { runScheduledKodyOnRunner } from "@dashboard/lib/runners/kody-runner";
import {
  goalRunRequest,
  withStoreTarget,
} from "@dashboard/lib/runners/run-request";
import { goalStatePath, type GoalRunState } from "@dashboard/lib/goal-state";
import {
  readManagedGoalFile,
  writeManagedGoalFile,
} from "@dashboard/lib/managed-goals-files";
import type { ManagedGoalState } from "@dashboard/lib/managed-goals";

function mapGithubError(error: any, fallback: string, status = 500) {
  if (error?.status === 401) {
    return NextResponse.json(
      { error: "github_token_expired" },
      { status: 401 },
    );
  }
  if (error?.status === 403 || error?.message?.includes("rate limit")) {
    return NextResponse.json(
      { error: "rate_limited", message: "GitHub API rate limit exceeded" },
      { status: 429 },
    );
  }
  return NextResponse.json(
    { error: fallback, message: error?.message ?? fallback },
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const actorResult = await verifyActorLogin(
      req,
      typeof body?.actorLogin === "string" ? body.actorLogin : undefined,
    );
    if (actorResult instanceof NextResponse) return actorResult;

    if (!headerAuth) {
      return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
    }

    let path: string;
    try {
      path = goalStatePath(id);
    } catch {
      return NextResponse.json({ error: "invalid_goal_id" }, { status: 400 });
    }

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const existing = await readManagedGoalFile(
      id,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (!existing) {
      return NextResponse.json(
        {
          error: "goal_not_started",
          message: "This goal has no runtime state — nothing to merge.",
        },
        { status: 409 },
      );
    }

    const previous = existing.state as unknown as GoalRunState;

    // Only a parked goal can be merged. Guard against double-clicks and
    // merging a goal that's still running.
    if (previous.state !== "awaiting-merge") {
      return NextResponse.json(
        {
          error: "not_awaiting_merge",
          message: `Goal is "${previous.state}", not "awaiting-merge" — only a goal whose tasks are all done can be merged.`,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    // Flip back to active + arm the one-shot. The engine's parkGoalForMerge
    // sees mergeApproved, consumes it, and lets the existing finalize run.
    const next: GoalRunState = {
      ...previous,
      version: 1,
      state: "active",
      mergeApproved: true,
      updatedAt: now,
    };
    delete next.pausedReason;

    await writeManagedGoalFile({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      id,
      message: `chore(goals): approve merge for ${id}`,
      state: next as unknown as ManagedGoalState,
      sha: existing.source === "todo" ? existing.sha : undefined,
    });

    // Take effect now, not on the next 15-min cron. Dispatch on the repo's
    // DEFAULT branch (a stale `main` can carry an outdated kody.yml).
    // Non-fatal: the cron is the backstop.
    let engineDispatched = false;
    const run = await runScheduledKodyOnRunner(req, {
      taskId: `goal-merge-${id}-${Date.now()}`,
      runRequest: withStoreTarget(goalRunRequest(id), headerAuth),
    });
    if (run.ok) {
      engineDispatched = true;
      logger.info(
        {
          goalId: id,
          owner: headerAuth.owner,
          repo: headerAuth.repo,
          ref: run.ref,
          runner: run.runner,
          machineId: run.machineId,
        },
        "goals: engine runner started on merge",
      );
    } else {
      logger.warn(
        { err: run.error, goalId: id, status: run.status },
        "goals: merge runner failed; cron will pick it up",
      );
    }

    return NextResponse.json(
      { state: next, engineDispatched },
      { status: 200 },
    );
  } catch (err) {
    return mapGithubError(err, "failed_to_merge_goal");
  } finally {
    clearGitHubContext();
  }
}
