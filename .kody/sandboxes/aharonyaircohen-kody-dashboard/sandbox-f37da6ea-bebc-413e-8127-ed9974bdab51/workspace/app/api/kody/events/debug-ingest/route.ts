/**
 * GET /api/kody/events/_debug?taskId=xxx
 *
 * Diagnostic-only — returns whether the in-memory bus has seen any
 * /ingest hits for this sessionId on the responding Vercel function
 * instance. Use to verify the engine's HttpSink is actually reaching
 * the dashboard from inside a GitHub Actions runner (Vercel's runtime
 * log CLI is too lossy to trust for low-volume routes).
 *
 * The counter is module-scoped so it doesn't survive across Vercel
 * function instances, but a single SSE/poll caller should land on the
 * same warm instance for the duration of a session.
 *
 * Public — no auth — only returns counts, not event payloads.
 */
import { NextRequest, NextResponse } from "next/server";
import { getIngestStats } from "@dashboard/lib/chat-event-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("taskId");
  if (!sessionId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  const stats = getIngestStats(sessionId);
  return NextResponse.json(
    { sessionId, ingest: stats ?? { count: 0, lastSeen: 0, lastEvent: "" } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
