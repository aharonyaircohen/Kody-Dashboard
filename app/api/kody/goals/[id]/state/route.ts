/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goal-runtime-state
 * @ai-summary Goal runtime state API. Reads/writes
 *   `.kody/goals/<id>/state.json` directly via the GitHub Contents API so
 *   the state lives in the repo (engine and dashboard share one source of
 *   truth). GET returns 404 when the file doesn't exist (= "not started").
 *   PUT creates or updates the file with the user's GitHub token, so the
 *   commit is authored by the actor — no service identity needed.
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
import { STATE_BRANCH } from "@dashboard/lib/state-branch";
import { logger } from "@dashboard/lib/logger";
import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  goalStatePath,
  type GoalRunState,
  type GoalRunStateValue,
} from "@dashboard/lib/goal-state";

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
      // Goal state lives on the dedicated state branch (engine reads it there).
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

    const existing = await fetchExisting(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      path,
    );
    if (!existing) {
      return NextResponse.json({ state: null }, { status: 200 });
    }
    const parsed = JSON.parse(existing.raw) as GoalRunState;
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
      ...(previous ?? {}),
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

    const content = Buffer.from(JSON.stringify(next, null, 2), "utf8").toString(
      "base64",
    );
    const message =
      parsed.data.state === "active"
        ? `chore(goals): start runner for ${id}`
        : `chore(goals): pause runner for ${id}`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      path,
      message,
      content,
      // Write to the dedicated state branch, not the default branch.
      branch: STATE_BRANCH,
      ...(existing?.sha ? { sha: existing.sha } : {}),
    });

    // Starting a goal must take effect now, not on the next 15-min cron tick.
    // Dispatch the engine workflow with no inputs — same shape as the cron
    // trigger — so the engine runs its normal lifecycle scan, sees the goal
    // is `active`, and picks it up within seconds. Non-fatal: the cron remains
    // the backstop, so a missing `workflow` token scope can't break Start.
    let engineDispatched = false;
    if (next.state === "active") {
      try {
        // Dispatch on the repo's DEFAULT branch, not a hardcoded "main".
        // workflow_dispatch runs the workflow file from the given ref; a
        // stale `main` can carry an outdated kody.yml that fails instantly
        // (e.g. renamed engine binary), while cron correctly uses the
        // default branch. Resolve it so Start matches the cron behaviour.
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
          {
            goalId: id,
            owner: headerAuth.owner,
            repo: headerAuth.repo,
            ref: defaultBranch,
          },
          "goals: engine dispatched on start",
        );
      } catch (dispatchErr) {
        logger.warn(
          { err: dispatchErr, goalId: id },
          "goals: engine dispatch failed; cron will pick it up",
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
