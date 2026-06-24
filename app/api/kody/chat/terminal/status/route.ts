/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern local-chat-terminal-status
 *
 * GET /api/kody/chat/terminal/status?chatSessionId=...
 *
 * Reports whether the current chat session has a live local terminal.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { getLocalTerminalSessionInfoByChatSession } from "@dashboard/lib/terminal/local-chat-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  chatSessionId: z.string().min(1).max(120),
  sandboxId: z.string().min(1).max(80).optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const parsed = Query.safeParse({
    chatSessionId: req.nextUrl.searchParams.get("chatSessionId"),
    sandboxId: req.nextUrl.searchParams.get("sandboxId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const session = getLocalTerminalSessionInfoByChatSession(
    parsed.data.chatSessionId,
    auth,
    parsed.data.sandboxId,
  );

  return NextResponse.json({ ok: true, session });
}
