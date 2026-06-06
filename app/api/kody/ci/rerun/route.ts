/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern ci-rerun
 * @ai-summary POST /api/kody/ci/rerun — re-run a completed workflow run by id.
 *   Powers the dashboard's "Re-run jobs" button on a red default-branch CI row.
 *   Body: { runId: number }. Uses the user's PAT when available so the re-run
 *   counts under their identity on the Actions tab.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
  rerunWorkflowRun,
} from "@dashboard/lib/github-client";
import { recordAudit } from "@dashboard/lib/activity/audit";

const schema = z.object({ runId: z.number().int().positive() });

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { runId } = schema.parse(body);

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to re-run a workflow.",
        },
        { status: 401 },
      );
    }

    await rerunWorkflowRun(runId, userOctokit);

    recordAudit(req, {
      action: "ci.rerun",
      resource: `run:${runId}`,
      detail: "manual re-run from dashboard",
    });

    return NextResponse.json({ ok: true, runId });
  } catch (error: any) {
    console.error("[ci/rerun] failed", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "rerun_failed",
        message: error?.message ?? "Failed to re-run workflow",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
