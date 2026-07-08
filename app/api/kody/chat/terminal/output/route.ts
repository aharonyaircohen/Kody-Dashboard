/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern local-chat-terminal-output
 *
 * GET /api/kody/chat/terminal/output?sessionId=...&cursor=...
 *
 * Reads terminal output produced after the supplied cursor.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { waitForLocalTerminalEvents } from "@dashboard/lib/terminal/local-chat-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  sessionId: z.string().min(1).max(120),
  cursor: z.coerce.number().int().min(0).default(0),
  waitMs: z.coerce.number().int().min(0).max(5_000).default(0),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const parsed = Query.safeParse({
    sessionId: req.nextUrl.searchParams.get("sessionId"),
    cursor: req.nextUrl.searchParams.get("cursor") ?? "0",
    waitMs: req.nextUrl.searchParams.get("waitMs") ?? "0",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await waitForLocalTerminalEvents(
    parsed.data.sessionId,
    auth,
    parsed.data.cursor,
    { timeoutMs: parsed.data.waitMs },
  );
  if (!result) {
    return NextResponse.json(
      { error: "terminal_session_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
