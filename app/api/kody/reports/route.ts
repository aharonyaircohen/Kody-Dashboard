/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern reports-api
 * @ai-summary Reports API — GET lists system reports under
 *   `kody-state:.kody/reports/<slug>.md` in the connected repo. Read-only:
 *   reports are produced by Kody duties, not edited from the dashboard.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { listReportFiles } from "@dashboard/lib/reports-files";

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const reports = await listReportFiles();
    return NextResponse.json({ reports });
  } catch (error: any) {
    console.error("[Reports] Error fetching reports:", error);

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
      { reports: [], error: error?.message || "Failed to fetch reports" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
