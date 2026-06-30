/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goal-runtime-state
 * @ai-summary Goal runtime state API. Reads/writes
 *   `todos/<id>.json` in the configured Kody state repo so
 *   the state lives in the repo (engine and dashboard share one source of
 *   truth). GET returns 404 when the file doesn't exist (= "not started").
 *   PUT creates or updates the file with the user's GitHub token, so the
 *   commit is authored by the actor — no service identity needed.
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
import { recordAudit } from "@dashboard/lib/activity/audit";
import { runScheduledKodyOnRunner } from "@dashboard/lib/runners/kody-runner";
import { goalRunRequest } from "@dashboard/lib/runners/run-request";
import {
  goalStatePath,
  makeInitialSimpleGoalState,
  type GoalRunState,
  type GoalRunStateValue,
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

const STATE_VALUES: readonly GoalRunStateValue[] = [
  "active",
  "paused",
  "done",
] as const;

const putBodySchema = z.object({
  state: z.enum(
    STATE_VALUES as unknown as [GoalRunStateValue, ...GoalRunStateValue[]],
  ),
  pausedReason: z.string().max(500).optional(),
  actorLogin: z.string().optional(),
});

export async function GET(
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

    if (!headerAuth) {
      return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
    }
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    let path: string;
    try {
      path = goalStatePath(id);
    } catch {
      return NextResponse.json({ error: "invalid_goal_id" }, { status: 400 });
    }

    const existing = await readManagedGoalFile(
      id,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (!existing) {
      return NextResponse.json({ state: null }, { status: 200 });
    }
    const parsed = existing.state as unknown as GoalRunState;
    return NextResponse.json({ state: parsed }, { status: 200 });
  } catch (err) {
    return mapGithubError(err, "failed_to_read_goal_state");
  } finally {
    clearGitHubContext();
  }
}

export async function PUT(
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
    const parsed = putBodySchema.safeParse(payload);
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

    // Refuse client → done. Only the engine completes a goal.
    if (parsed.data.state === "done") {
      return NextResponse.json(
        {
          error: "client_cannot_complete",
          message:
            "The dashboard cannot mark a goal done — only the engine sets state=done.",
        },
        { status: 400 },
      );
    }

    // Spread `previous` first so engine-owned fields (e.g. `goalIssueNumber`,
    // `lastDispatchedIssue`, `goalPrUrl`) round-trip through dashboard pause/
    // resume. Without this, every pause/resume wipes those fields and the
    // engine has to re-derive them — which on `goalIssueNumber` means
    // creating a duplicate umbrella issue on the next goal-tick.
    const next: GoalRunState = {
      ...(previous ?? makeInitialSimpleGoalState(id, new Date(now))),
      version: 1,
      state: parsed.data.state,
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
      ...(parsed.data.state === "paused" && parsed.data.pausedReason
        ? { pausedReason: parsed.data.pausedReason }
        : {}),
    };
    // Drop pausedReason when leaving paused — stale reasons confuse the UI.
    if (parsed.data.state !== "paused") {
      delete next.pausedReason;
    }

    const message =
      parsed.data.state === "active"
        ? `chore(goals): start runner for ${id}`
        : `chore(goals): pause runner for ${id}`;

    await writeManagedGoalFile({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      id,
      message,
      state: next as unknown as ManagedGoalState,
      sha: existing?.source === "todo" ? existing.sha : undefined,
    });

    // Starting a goal must take effect now, not on the next cron tick.
    // Run the same scheduled engine path through the shared runner. Non-fatal:
    // cron remains the backstop if a runner cannot start.
    let engineDispatched = false;
    if (next.state === "active") {
      const run = await runScheduledKodyOnRunner(req, {
        taskId: `goal-start-${id}-${Date.now()}`,
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
          "goals: engine runner started on start",
        );
      } else {
        logger.warn(
          { err: run.error, goalId: id, status: run.status },
          "goals: engine runner failed on start; cron will pick it up",
        );
      }
    }

    recordAudit(req, {
      action: "goal.state",
      resource: id,
      outcome: "ok",
      detail: `set goal state → ${parsed.data.state}`,
    });

    return NextResponse.json(
      { state: next, engineDispatched },
      { status: 200 },
    );
  } catch (err) {
    return mapGithubError(err, "failed_to_write_goal_state");
  } finally {
    clearGitHubContext();
  }
}
