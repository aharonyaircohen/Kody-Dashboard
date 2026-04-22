/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-event-ingest
 *
 * POST /api/kody/events/ingest?sessionId=xxx&token=yyy
 *
 * Public endpoint the kody2 engine posts chat events to during a session.
 * Auth is the HMAC session token (minted at dispatch, embedded inline in
 * the dashboardUrl passed to the workflow). No GitHub or Kody cookie auth —
 * this is called from Actions runners.
 *
 * Body: { event: string, payload: unknown, runId?: string, emittedAt?: string }
 * Also accepts an array of events for batching.
 *
 * Events are fanned out to any SSE stream subscribers for this sessionId.
 * The engine also commits events to `.kody/events/{id}.jsonl` for durability;
 * this endpoint is the low-latency path.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@dashboard/lib/chat-token";
import { publish } from "@dashboard/lib/chat-event-bus";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IngestEvent {
  event: string;
  payload?: unknown;
  runId?: string;
  emittedAt?: string;
}

function extractToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return req.nextUrl.searchParams.get("token");
}

export async function POST(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const token = extractToken(req);
  if (!token || !verifySessionToken(sessionId, token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: IngestEvent | IngestEvent[];
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const events = Array.isArray(body) ? body : [body];
  for (const event of events) {
    if (!event || typeof event.event !== "string") {
      return NextResponse.json({ error: "event field required" }, { status: 400 });
    }
    publish(sessionId, {
      event: event.event,
      payload: event.payload ?? {},
      runId: event.runId ?? "",
      emittedAt: event.emittedAt ?? new Date().toISOString(),
    });
  }

  logger.debug({ sessionId, count: events.length }, "chat: ingested events");
  return new NextResponse(null, { status: 204 });
}
