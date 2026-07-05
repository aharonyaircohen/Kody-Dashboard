/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agency-runs-api
 * @ai-summary GET /api/kody/agency-runs returns Kody-native runs for
 *   user-owned AI Agency objects: goals, loops, and workflows.
 */
import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { listAgencyRuns } from "@dashboard/lib/agency-runs";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";

function parseLimit(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  if (!Number.isFinite(raw)) return 50;
  return Math.max(1, Math.min(100, Math.floor(raw)));
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

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
    const payload = await listAgencyRuns({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      limit: parseLimit(req),
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to read agency runs";
    return NextResponse.json(
      {
        error: "failed_to_read_agency_runs",
        message,
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
