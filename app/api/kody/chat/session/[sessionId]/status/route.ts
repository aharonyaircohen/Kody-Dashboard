/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern session-status
 *
 * GET /api/kody/chat/session/[sessionId]/status
 *
 * Server truth-of-record for a Kody Live session. The dashboard polls this
 * when its local watchdog can't decide whether a session is alive (booting
 * for > 90s without events, awaiting reply for > 180s without events, or
 * tab returning from background).
 *
 * Truth is derived from the events JSONL file the engine writes to GitHub
 * (`.kody/events/{sessionId}.jsonl`). The runner itself owns no signal we
 * can query directly; the file's last line, last event type, and event age
 * are the only signals we get.
 *
 * Response (no client-side cache — always fresh):
 *   {
 *     sessionId: string,
 *     exists: boolean,             // file exists in the repo
 *     totalEvents: number,
 *     lastEventType: string | null,
 *     lastEventAt: number | null,  // ms since epoch from the event's own ts
 *     ageMs: number | null,        // server clock - lastEventAt
 *     inferredPhase: 'unknown' | 'booting' | 'live' | 'ended' | 'errored',
 *     runnerAlive: boolean,        // false = client should mark stuck
 *     reason: string | null,       // human-readable why
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { readEventsFile } from "@dashboard/lib/chat-events-reader";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_THRESHOLD_MS = 60_000;

function getDefaultOwner(): string {
  return process.env.GITHUB_OWNER ?? "aharonyaircohen";
}
function getDefaultRepo(): string {
  return process.env.GITHUB_REPO ?? "Kody-Dashboard";
}
function getDefaultBranch(): string {
  return process.env.KODY_STORE_BRANCH ?? "main";
}

function promoteAuthFromQuery(req: NextRequest): NextRequest {
  const token = req.nextUrl.searchParams.get("token");
  const owner = req.nextUrl.searchParams.get("owner");
  const repo = req.nextUrl.searchParams.get("repo");
  if (!token && !owner && !repo) return req;
  const headers = new Headers(req.headers);
  if (token && !headers.has("x-kody-token"))
    headers.set("x-kody-token", token);
  if (owner && !headers.has("x-kody-owner"))
    headers.set("x-kody-owner", owner);
  if (repo && !headers.has("x-kody-repo")) headers.set("x-kody-repo", repo);
  return new NextRequest(req.url, { headers, method: req.method });
}

interface ParsedEvent {
  event: string;
  timestamp: number | null;
}

/** Best-effort parse of an events JSONL line. Tolerates schema drift. */
function parseEvent(line: string): ParsedEvent | null {
  try {
    const obj = JSON.parse(line) as {
      event?: string;
      timestamp?: string | number;
      payload?: { timestamp?: string | number };
    };
    if (!obj || typeof obj.event !== "string") return null;
    const rawTs = obj.timestamp ?? obj.payload?.timestamp;
    let ts: number | null = null;
    if (typeof rawTs === "number") ts = rawTs;
    else if (typeof rawTs === "string") {
      const parsed = Date.parse(rawTs);
      ts = Number.isFinite(parsed) ? parsed : null;
    }
    return { event: obj.event, timestamp: ts };
  } catch {
    return null;
  }
}

type InferredPhase = "unknown" | "booting" | "live" | "ended" | "errored";

interface InferResult {
  phase: InferredPhase;
  alive: boolean;
  reason: string | null;
}

function inferPhase(
  lastEventType: string | null,
  ageMs: number | null,
  totalEvents: number,
  clientStaleAgeMs: number | null,
): InferResult {
  if (totalEvents === 0) {
    // No commits in the events file. Two scenarios diverge here:
    //
    // (a) The engine just booted and hasn't flushed yet — common in the
    //     first 30-60s of a fresh session.
    // (b) The engine emitted events via the real-time HTTP push to
    //     /api/kody/events/ingest but died before committing the file.
    //     The dashboard saw the events on SSE; we can't see them from
    //     here. This is a real zombie state.
    //
    // The client's own `lastEventAt` disambiguates: if the dashboard
    // saw events on SSE long ago and nothing has been committed since,
    // it's case (b) — declare the runner dead.
    if (
      clientStaleAgeMs !== null &&
      clientStaleAgeMs > STALE_THRESHOLD_MS
    ) {
      return {
        phase: "live",
        alive: false,
        reason: `dashboard saw events ${Math.round(clientStaleAgeMs / 1000)}s ago but none have been committed (zombie via real-time push)`,
      };
    }
    return {
      phase: "unknown",
      alive: true,
      reason: "no events committed yet",
    };
  }
  if (lastEventType === "chat.exit") {
    return { phase: "ended", alive: false, reason: "runner emitted chat.exit" };
  }
  if (lastEventType === "chat.error") {
    return {
      phase: "errored",
      alive: false,
      reason: "runner emitted chat.error",
    };
  }
  // chat.ready / chat.message / chat.done / chat.thinking / chat.tool / ...
  // These all imply the runner was alive at the timestamp of the last event.
  // If the last event is recent, it's still alive. If it's stale, the
  // runner has gone silent — likely dead without emitting chat.exit.
  if (ageMs === null) {
    return {
      phase: "live",
      alive: true,
      reason: "event ts unavailable; treating as live",
    };
  }
  if (ageMs > STALE_THRESHOLD_MS) {
    return {
      phase: "live",
      alive: false,
      reason: `last event ${Math.round(ageMs / 1000)}s ago — no chat.exit (zombie suspected)`,
    };
  }
  // Booting heuristic: only chat.ready and earlier means we're still
  // starting up. Once any user-facing event appears, the session is live.
  const phase: InferredPhase =
    lastEventType === "chat.ready" ? "booting" : "live";
  return { phase, alive: true, reason: null };
}

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(rawReq: NextRequest, ctx: RouteContext) {
  const req = promoteAuthFromQuery(rawReq);
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const { sessionId } = await ctx.params;
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId required" },
      { status: 400 },
    );
  }

  const headerAuth = getRequestAuth(req);
  const owner = headerAuth?.owner ?? getDefaultOwner();
  const repo = headerAuth?.repo ?? getDefaultRepo();
  const branch = getDefaultBranch();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "No GitHub token available" },
      { status: 503 },
    );
  }

  let result;
  try {
    result = await readEventsFile(octokit, owner, repo, branch, sessionId);
  } catch (err) {
    logger.error(
      { err, sessionId, owner, repo },
      "chat/session/status: read failed",
    );
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }

  // Walk from the tail to find the most recent parseable event. Defensive
  // against trailing blank lines or partial writes from concurrent commits.
  let lastEventType: string | null = null;
  let lastEventAt: number | null = null;
  for (let i = result.lines.length - 1; i >= 0; i--) {
    const parsed = parseEvent(result.lines[i]);
    if (!parsed) continue;
    lastEventType = parsed.event;
    lastEventAt = parsed.timestamp;
    break;
  }

  const ageMs = lastEventAt !== null ? Date.now() - lastEventAt : null;
  // Optional: client's own lastEventAt (from in-process SSE/poll) lets us
  // detect the "engine pushed events via HTTP only, then died before
  // committing the file" case — common when a runner is killed shortly
  // after boot and before its periodic flush.
  const clientLastRaw = req.nextUrl.searchParams.get("clientLastEventAt");
  const clientLastEventAt =
    clientLastRaw && Number.isFinite(Number(clientLastRaw))
      ? Number(clientLastRaw)
      : null;
  const clientStaleAgeMs =
    clientLastEventAt !== null ? Date.now() - clientLastEventAt : null;
  const { phase, alive, reason } = inferPhase(
    lastEventType,
    ageMs,
    result.lines.length,
    clientStaleAgeMs,
  );

  return NextResponse.json(
    {
      sessionId,
      exists: result.exists,
      totalEvents: result.lines.length,
      lastEventType,
      lastEventAt,
      ageMs,
      inferredPhase: phase,
      runnerAlive: alive,
      reason,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
