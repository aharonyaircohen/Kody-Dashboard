/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-event-ingest
 *
 * POST /api/kody/events/ingest?sessionId=xxx
 *
 * Public endpoint the kody engine posts chat events to during a session.
 *
 * Auth: GitHub Actions IP verification — the engine runs on a GitHub-
 * hosted Actions runner whose source IP is in the `actions` CIDR list
 * published at https://api.github.com/meta. Same trust model as the
 * webhook receiver (no shared secret to provision). HMAC token auth was
 * dropped because it required KODY_SESSION_SECRET, which not every
 * deployment has — reusing GitHub's identity is friction-free.
 *
 * Body: { event: string, payload: unknown, runId?: string, emittedAt?: string }
 * Also accepts an array of events for batching.
 *
 * Events are fanned out to any SSE / long-poll subscribers for this
 * sessionId. The engine also commits events to `.kody/events/{id}.jsonl`
 * for durability; this endpoint is the low-latency path.
 */

import { NextRequest, NextResponse } from "next/server";
import { publish } from "@dashboard/lib/chat-event-bus";
import { isFromGitHubActions, getClientIp } from "@dashboard/lib/webhooks/github-ip";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IngestEvent {
  event: string;
  payload?: unknown;
  runId?: string;
  emittedAt?: string;
}

export async function POST(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  // IP verification — only GitHub Actions runners can post events here.
  // INGEST_ALLOW_ANY_IP=1 disables the gate (local dev, integration tests).
  if (process.env.INGEST_ALLOW_ANY_IP !== "1") {
    const ip = getClientIp(req.headers);
    const ok = await isFromGitHubActions(ip);
    if (!ok) {
      logger.warn({ event: "ingest_ip_rejected", ip, sessionId }, "ingest: rejecting non-GHA IP");
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
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
