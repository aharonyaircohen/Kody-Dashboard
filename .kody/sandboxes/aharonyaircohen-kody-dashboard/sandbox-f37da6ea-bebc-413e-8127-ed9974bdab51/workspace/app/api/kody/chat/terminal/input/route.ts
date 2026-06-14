/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern local-chat-terminal-input
 *
 * POST /api/kody/chat/terminal/input
 *
 * Writes one line of user input into an authenticated local PTY session.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { writeLocalTerminalInput } from "@dashboard/lib/terminal/local-chat-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.string().min(1).max(120),
  input: z.string().max(20_000),
  raw: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const ok = writeLocalTerminalInput(
    parsed.data.sessionId,
    auth,
    parsed.data.input,
    { raw: parsed.data.raw },
  );
  if (!ok) {
    return NextResponse.json(
      { error: "terminal_session_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
