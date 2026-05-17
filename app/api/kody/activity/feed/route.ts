/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern activity-feed-api
 * @ai-summary GET /api/kody/activity/feed — the on-demand "Feed" tab of the
 *   Activity page. Reads the engine's append-only event log
 *   (`.kody/event-log.jsonl`) so chat + engine-step events finally show up,
 *   which run-only Activity can't see. Unlike `/api/kody/activity` this is
 *   NOT polled — the client fetches it only when the Feed tab is opened —
 *   and it goes through `readEventLogCached` (60s cache + in-flight dedup +
 *   stale fallback) so it stays within the CLAUDE.md rate-limit rules.
 */
import { NextRequest, NextResponse } from "next/server";
import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import { readEventLogCached } from "@dashboard/lib/activity/feed-source";
import { buildFeedSnapshot } from "@dashboard/lib/activity/feed";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    // The event log lives in the *connected* repo; without header auth we
    // have no repo to read. (The polled health view still works via env.)
    return NextResponse.json({ events: [], total: 0, computedAt: new Date().toISOString() });
  }

  try {
    const entries = await readEventLogCached(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
    );
    return NextResponse.json(buildFeedSnapshot(entries));
  } catch (error: unknown) {
    return handleKodyApiError(error, "activity-feed");
  }
}
