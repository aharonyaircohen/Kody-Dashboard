/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern local-chat-terminal-start
 *
 * POST /api/kody/chat/terminal/start
 *
 * Starts an authenticated local PTY session for KodyChat's terminal mode.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { startLocalTerminalSession } from "@dashboard/lib/terminal/local-chat-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  chatSessionId: z.string().min(1).max(120).optional(),
  cols: z.number().int().min(20).max(300).optional(),
  rows: z.number().int().min(8).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const session = await startLocalTerminalSession({
    owner: auth.owner,
    repo: auth.repo,
    chatSessionId: parsed.data.chatSessionId,
    cols: parsed.data.cols,
    rows: parsed.data.rows,
  });

  return NextResponse.json({ ok: true, session });
}
