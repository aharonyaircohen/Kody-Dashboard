/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goal-runtime-state
 * @ai-summary Toggle "let Kody manage this goal end-to-end". Writes the
 *   `managed` boolean into `todos/<id>.md` in the configured Kody state repo. When enabling on
 *   a goal that was never started, it also creates the state file as
 *   `active` + `managed` and dispatches the engine so both `goal-tick`
 *   and the `goal-manager` agent pick it up within seconds. Separate
 *   from the state route on purpose: that route's contract is
 *   "start/pause the runner"; this one carries the autonomy intent.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { runScheduledKodyOnRunner } from "@dashboard/lib/runners/kody-runner";
import { goalRunRequest } from "@dashboard/lib/runners/run-request";
import {
  goalStatePath,
  makeInitialSimpleGoalState,
  type GoalRunState,
} from "@dashboard/lib/goal-state";
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

const bodySchema = z.object({
  managed: z.boolean(),
  actorLogin: z.string().optional(),
});

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

    const existing = await readManagedGoalFile(
      id,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const now = new Date().toISOString();
    const previous: GoalRunState | null = existing
      ? (existing.state as unknown as GoalRunState)
      : null;

    // Enabling management on a never-started goal implies it should run:
    // seed an active state so goal-tick AND the agent both engage. A
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

    const base: GoalRunState =
      previous ?? makeInitialSimpleGoalState(id, new Date(now));
    const next: GoalRunState = {
      ...base,
      version: 1,
      managed: parsed.data.managed,
      updatedAt: now,
    };

    await writeManagedGoalFile({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      id,
      message: `chore(goals): ${
        parsed.data.managed ? "enable" : "disable"
      } Kody management for ${id}`,
      state: next as unknown as ManagedGoalState,
      sha: existing?.source === "todo" ? existing.sha : undefined,
    });

    // Take effect now, not on the next cron. Dispatch on the repo's
    // default branch (a stale main can carry an outdated kody.yml).
    // Non-fatal: the agent/goal-tick crons are the backstop.
    let engineDispatched = false;
    if (parsed.data.managed && next.state === "active") {
      const run = await runScheduledKodyOnRunner(req, {
        taskId: `goal-manage-${id}-${Date.now()}`,
        runRequest: goalRunRequest(id),
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
          "goals: engine runner started on manage-enable",
        );
      } else {
        logger.warn(
          { err: run.error, goalId: id, status: run.status },
          "goals: manage runner failed; cron will pick it up",
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
