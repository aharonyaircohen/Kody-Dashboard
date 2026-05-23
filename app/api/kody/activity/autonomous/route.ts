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
  fetchRecentCommits,
} from "@dashboard/lib/github-client";
import { buildAutonomousFeed } from "@dashboard/lib/activity/autonomous";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ events: [], total: 0 }, { status: 200 });
  }

  try {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
    const [prs, commits] = await Promise.all([
      fetchRecentPRs(),
      fetchRecentCommits(),
    ]);
    const events = buildAutonomousFeed(prs, commits);
    return NextResponse.json({
      events,
      total: events.length,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { events: [], error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
