/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agency-run-detail-api
 * @ai-summary GET /api/kody/agency-runs/detail reads one run source file.
 */
import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { readAgencyRunDetail } from "@dashboard/lib/agency-runs";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const sourcePath = req.nextUrl.searchParams.get("path")?.trim();
  if (!sourcePath) {
    return NextResponse.json({ error: "missing_path" }, { status: 400 });
  }
  const githubRunId = req.nextUrl.searchParams.get("githubRunId")?.trim();

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
    const payload = await readAgencyRunDetail({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      sourcePath,
      githubRunId,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to read run detail";
    const status = message === "unsupported_run_detail_path" ? 400 : 500;
    return NextResponse.json(
      {
        error: "failed_to_read_run_detail",
        message,
      },
      { status },
    );
  } finally {
    clearGitHubContext();
  }
}
