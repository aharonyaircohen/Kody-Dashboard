/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern activity-autonomous-api
 * @ai-summary GET /api/kody/activity/autonomous — the "Auto" tab of the
 *   Activity page. Surfaces Kody's autonomous work product (the PRs it
 *   opens / merges / closes on its own), which the dashboard's own action
 *   log never sees. Backed by the cached `fetchRecentPRs` GraphQL query, so
 *   it's polling-safe (TTL + in-flight dedup + stale fallback).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
  fetchRecentPRs,
} from "@dashboard/lib/github-client";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ prs: [], total: 0 }, { status: 200 });
  }

  try {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
    const prs = await fetchRecentPRs();
    return NextResponse.json({
      prs,
      total: prs.length,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { prs: [], error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
