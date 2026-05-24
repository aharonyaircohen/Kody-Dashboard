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
import type { Octokit } from "@octokit/rest";
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
import { goalStatePath, type GoalRunState } from "@dashboard/lib/goal-state";

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

interface FileResponse {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
}

async function fetchExisting(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<{ raw: string; sha: string } | null> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      headers: { "If-None-Match": "" },
    });
    const data = res.data as FileResponse | FileResponse[];
    if (Array.isArray(data) || data.type !== "file" || !data.content)
      return null;
    const buf = Buffer.from(
      data.content,
      (data.encoding ?? "base64") as BufferEncoding,
    );
    return { raw: buf.toString("utf8"), sha: data.sha ?? "" };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
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

    const existing = await fetchExisting(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      path,
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

    const previous = JSON.parse(existing.raw) as GoalRunState;

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

    const content = Buffer.from(JSON.stringify(next, null, 2), "utf8").toString(
      "base64",
    );

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      path,
      message: `chore(goals): approve merge for ${id}`,
      content,
      ...(existing.sha ? { sha: existing.sha } : {}),
    });

    // Take effect now, not on the next 15-min cron. Dispatch on the repo's
    // DEFAULT branch (a stale `main` can carry an outdated kody.yml).
    // Non-fatal: the cron is the backstop.
    let engineDispatched = false;
    try {
      const repoMeta = await octokit.rest.repos.get({
        owner: headerAuth.owner,
        repo: headerAuth.repo,
      });
      const defaultBranch = repoMeta.data.default_branch || "main";
      await octokit.rest.actions.createWorkflowDispatch({
        owner: headerAuth.owner,
        repo: headerAuth.repo,
        workflow_id: "kody.yml",
        ref: defaultBranch,
      });
      engineDispatched = true;
      logger.info(
        { goalId: id, owner: headerAuth.owner, repo: headerAuth.repo },
        "goals: engine dispatched on merge",
      );
    } catch (dispatchErr) {
      logger.warn(
        { err: dispatchErr, goalId: id },
        "goals: merge dispatch failed; cron will pick it up",
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
