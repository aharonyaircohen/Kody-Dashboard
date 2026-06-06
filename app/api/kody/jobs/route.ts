/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern jobs-api
 * @ai-summary Run an INSTANT job. A job assembles executable (how) + duty (why)
 *   + persona (who) + schedule (when); an instant job runs once now, so we lower
 *   it onto the same dispatch the executable "Run" button uses — post
 *   `@kody <executable> [why]` on the target issue/PR. The engine mints the
 *   instant Job from that comment (mintInstantJob) and runs it via runJob.
 *
 *   Scheduled jobs are NOT dispatched here — their source of truth is a duty
 *   file (staff + every + intent), created via the duties API. This endpoint
 *   rejects `flavor: "scheduled"` so the two paths never blur.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { invalidateIssueCache } from "@dashboard/lib/github-client";
import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  validateKodyJob,
  resolveJobProfile,
  renderInstantJobComment,
  InvalidKodyJobError,
} from "@dashboard/lib/kody-job";

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  try {
    const raw = await req.json();
    const actorLogin =
      typeof raw?.actorLogin === "string" ? raw.actorLogin : undefined;

    // Validate against the engine's Job boundary rules (executable|duty,
    // known flavor, object cliArgs). Throws InvalidKodyJobError otherwise.
    const job = validateKodyJob(raw);

    if (job.flavor !== "instant") {
      return NextResponse.json(
        {
          error: "not_instant",
          message:
            "Only instant jobs run here. Save a scheduled job as a duty (staff + schedule + executable).",
        },
        { status: 400 },
      );
    }
    if (typeof job.target !== "number") {
      return NextResponse.json(
        {
          error: "no_target",
          message: "An instant job needs a target issue/PR.",
        },
        { status: 400 },
      );
    }
    if (!resolveJobProfile(job)) {
      return NextResponse.json(
        { error: "no_executable", message: "Pick an executable (the how)." },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message: "A signed-in GitHub token is required to comment.",
        },
        { status: 401 },
      );
    }

    const commentBody = renderInstantJobComment(job);
    const { data } = await userOctokit.rest.issues.createComment({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      issue_number: job.target,
      body: commentBody,
    });

    invalidateIssueCache(job.target);
    recordAudit(req, {
      action: "job.run",
      resource: resolveJobProfile(job) ?? "job",
      detail: `instant job ${commentBody} on #${job.target}`,
    });

    return NextResponse.json({
      success: true,
      commentUrl: data.html_url,
      dispatch: commentBody,
    });
  } catch (error: any) {
    if (error instanceof InvalidKodyJobError) {
      return NextResponse.json(
        { error: "invalid_job", message: error.message },
        { status: 400 },
      );
    }
    console.error("[Jobs] Error running job:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "run_failed", message: error?.message ?? "Failed to run job" },
      { status: 500 },
    );
  }
}
