/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern jobs-api
 * @ai-summary Run an INSTANT capability job. The dashboard posts
 *   `@kody <capability> [why]` on the target issue/PR.
 *
 *   Scheduled jobs are NOT dispatched here. This endpoint
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
import {
  clearGitHubContext,
  invalidateIssueCache,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { readResolvedCapabilityFile } from "@dashboard/lib/capabilities";
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
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const raw = await req.json();
    const actorLogin =
      typeof raw?.actorLogin === "string" ? raw.actorLogin : undefined;

    // Dashboard boundary: a capability is required.
    const job = validateKodyJob(raw);

    if (job.flavor !== "instant") {
      return NextResponse.json(
        {
          error: "not_instant",
          message:
            "Only instant jobs run here. Save scheduled work as a capability loop.",
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
        { error: "no_capability", message: "Pick a capability to run." },
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
    const capability = await readResolvedCapabilityFile(
      job.capability!,
      userOctokit,
    );
    if (!capability) {
      return NextResponse.json(
        {
          error: "capability_not_found",
          message: `Capability "${job.capability}" does not exist.`,
        },
        { status: 400 },
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
  } finally {
    clearGitHubContext();
  }
}
