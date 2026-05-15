/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern kody-events
 *
 * POST /api/kody/events
 * Dashboard receives events from the engine (via HTTP) and logs them.
 * The engine calls this when the dashboard hook fires.
 *
 * GET /api/kody/events?runId=xxx
 * Chat UI fetches event history for a run.
 */

import { NextRequest, NextResponse } from "next/server";
import { logEvent, getEventHistory } from "@dashboard/lib/kody-store/event-log";
import { getActionState } from "@dashboard/lib/kody-store/action-state";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId)
    return NextResponse.json({ error: "runId required" }, { status: 400 });

  const headerAuth = getRequestAuth(req);
  const owner =
    headerAuth?.owner ?? process.env.GITHUB_OWNER ?? "aharonyaircohen";
  const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? "Kody-Dashboard";
  const octokit = await getUserOctokit(req);

  const history = await getEventHistory(runId, { owner, repo, octokit });
  return NextResponse.json({ events: history });
}

export async function POST(req: NextRequest) {
  // This endpoint is called by the engine (via its dashboard hook) or by the dashboard itself.
  // No auth required — the engine's dashboard hook fires internally.
  // Production: validate origin or add a shared secret (KODY_ACTION_SECRET).

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event, payload, actionState, channel } = body as {
    event?: string;
    payload?: Record<string, unknown>;
    actionState?: { status: string; step: string; sessionId?: string };
    channel?: string;
  };

  if (!event)
    return NextResponse.json({ error: "event required" }, { status: 400 });

  const headerAuth = getRequestAuth(req);
  const owner =
    headerAuth?.owner ?? process.env.GITHUB_OWNER ?? "aharonyaircohen";
  const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? "Kody-Dashboard";
  const octokit = await getUserOctokit(req);

  let entry;
  try {
    entry = await logEvent(
      event,
      payload ?? {},
      actionState,
      channel ?? "pipeline",
      { owner, repo, octokit },
    );
  } catch (err) {
    // GitHub API write failed (e.g. no token configured).
    // Return ok=true so the engine can continue even if logging fails.
    entry = null;
  }

  return NextResponse.json({ ok: true, entry });
}
