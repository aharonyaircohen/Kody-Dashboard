/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goal-runtime-state
 * @ai-summary Toggle "let Kody manage this goal end-to-end". Writes the
 *   `managed` boolean into `.kody/goals/<id>/state.json`. When enabling on
 *   a goal that was never started, it also creates the state file as
 *   `active` + `managed` and dispatches the engine so both `goal-tick`
 *   and the `goal-manager` staff member pick it up within seconds. Separate
 *   from the state route on purpose: that route's contract is
 *   "start/pause the runner"; this one carries the autonomy intent.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Octokit } from "@octokit/rest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
import {
  goalStatePath,
  makeInitialActiveState,
  type GoalRunState,
} from "@dashboard/lib/goal-state";
import { STATE_BRANCH } from "@dashboard/lib/state-branch";

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

const bodySchema = z.object({
  managed: z.boolean(),
  actorLogin: z.string().optional(),
});

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
      // Goal state lives on the dedicated state branch.
      ref: STATE_BRANCH,
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

    const payload = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
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
    const now = new Date().toISOString();
    const previous: GoalRunState | null = existing
      ? (JSON.parse(existing.raw) as GoalRunState)
      : null;

    // Enabling management on a never-started goal implies it should run:
    // seed an active state so goal-tick AND the staff member both engage. A
    // done goal can't be re-managed (the deliverable PR is already open).
    if (!previous && !parsed.data.managed) {
      return NextResponse.json(
        { error: "goal_not_started", message: "Nothing to unmanage." },
        { status: 409 },
      );
    }
    if (previous?.state === "done") {
      return NextResponse.json(
        {
          error: "goal_done",
          message: "Goal is already done — its deliverable PR is open.",
        },
        { status: 409 },
      );
    }

    const base: GoalRunState = previous ?? makeInitialActiveState(new Date());
    const next: GoalRunState = {
      ...base,
      version: 1,
      managed: parsed.data.managed,
      updatedAt: now,
    };

    const content = Buffer.from(JSON.stringify(next, null, 2), "utf8").toString(
      "base64",
    );

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      path,
      message: `chore(goals): ${
        parsed.data.managed ? "enable" : "disable"
      } Kody management for ${id}`,
      content,
      branch: STATE_BRANCH,
      ...(existing?.sha ? { sha: existing.sha } : {}),
    });

    // Take effect now, not on the next cron. Dispatch on the repo's
    // default branch (a stale main can carry an outdated kody.yml).
    // Non-fatal: the staff/goal-tick crons are the backstop.
    let engineDispatched = false;
    if (parsed.data.managed && next.state === "active") {
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
          "goals: engine dispatched on manage-enable",
        );
      } catch (dispatchErr) {
        logger.warn(
          { err: dispatchErr, goalId: id },
          "goals: manage dispatch failed; cron will pick it up",
        );
      }
    }

    return NextResponse.json(
      { state: next, engineDispatched },
      { status: 200 },
    );
  } catch (err) {
    return mapGithubError(err, "failed_to_set_goal_managed");
  } finally {
    clearGitHubContext();
  }
}
