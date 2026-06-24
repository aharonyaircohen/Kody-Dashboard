/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern reports-api
 * @ai-summary Report detail API — GET reads a single report file under
 *   `reports/<slug>.md` in the configured Kody state repo. Read-only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { readReportFile, isValidSlug } from "@dashboard/lib/reports-files";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const report = await readReportFile(slug);
    if (!report) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ report });
  } catch (error: any) {
    console.error("[Reports] Error fetching report:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch report",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
