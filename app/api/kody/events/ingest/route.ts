/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-event-ingest
 *
 * POST /api/kody/events/ingest?sessionId=xxx
 *
 * Public endpoint the kody engine posts chat events to during a session.
 *
 * Auth (either passes):
 *  1. `?token=<hex>` HMAC of sessionId signed with KODY_MASTER_KEY —
 *     used by the Fly runner path (Fly machine IPs are not in GitHub's
 *     CIDR list, so IP gating doesn't work for them).
 *  2. Source IP in GitHub Actions's published CIDR ranges
 *     (`api.github.com/meta`) — used by the GH Actions engine path.
 *
 * No `INGEST_ALLOW_ANY_IP` escape hatch — either prove identity via the
 * token or come from a GitHub Actions runner. Tests can hit the endpoint
 * by minting a token with KODY_MASTER_KEY locally.
 *
 * Body: { event: string, payload: unknown, runId?: string, emittedAt?: string }
 * Also accepts an array of events for batching.
 *
 * Events are fanned out to any SSE / long-poll subscribers for this
 * sessionId. The engine also persists events to the configured state repo
 * for durability; this endpoint is the low-latency path.
 */

import { NextRequest, NextResponse } from "next/server";
import { publish, recordIngest } from "@dashboard/lib/chat-event-bus";
import {
  isFromGitHubActions,
  getClientIp,
} from "@dashboard/lib/webhooks/github-ip";
import { verifySessionToken } from "@dashboard/lib/chat-token";
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

  // Auth: token (Fly runner path) OR GitHub Actions source IP (GHA path).
  // The token verifies sha256-HMAC(sessionId, kody-chat-token:KODY_MASTER_KEY) —
  // see chat-token.ts. Cheaper than the IP check, so try it first.
  const token = req.nextUrl.searchParams.get("token");
  let authed = false;
  let authMode: "token" | "gh-ip" | "" = "";
  if (token) {
    try {
      if (verifySessionToken(sessionId, token)) {
        authed = true;
        authMode = "token";
      }
    } catch (err) {
      logger.warn({ err, sessionId }, "ingest: token verify threw");
    }
  }
  if (!authed) {
    const ip = getClientIp(req.headers);
    if (await isFromGitHubActions(ip)) {
      authed = true;
      authMode = "gh-ip";
    } else {
      logger.warn(
        { event: "ingest_rejected", ip, sessionId, hasToken: !!token },
        "ingest: no valid token and IP not in GitHub Actions CIDR",
      );
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
      return NextResponse.json(
        { error: "event field required" },
        { status: 400 },
      );
    }
    publish(sessionId, {
      event: event.event,
      payload: event.payload ?? {},
      runId: event.runId ?? "",
      emittedAt: event.emittedAt ?? new Date().toISOString(),
    });
    recordIngest(sessionId, event.event);
  }

  logger.debug(
    { sessionId, count: events.length, authMode },
    "chat: ingested events",
  );
  return new NextResponse(null, { status: 204 });
}
