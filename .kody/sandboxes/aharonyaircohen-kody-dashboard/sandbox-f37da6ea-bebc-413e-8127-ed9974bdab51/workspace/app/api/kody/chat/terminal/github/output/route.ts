/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern github-actions-terminal-output
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { readGitHubActionsTerminalEvents } from "@dashboard/lib/terminal/github-actions-terminal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  sessionId: z.string().min(1).max(120),
  cursor: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

  const parsed = Query.safeParse({
    sessionId: req.nextUrl.searchParams.get("sessionId"),
    cursor: req.nextUrl.searchParams.get("cursor") ?? "0",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    const result = await readGitHubActionsTerminalEvents(
      req,
      auth,
      parsed.data.sessionId,
      parsed.data.cursor,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read GitHub Actions terminal output";
    return NextResponse.json({ error: "github_terminal_output_failed", message }, { status: 500 });
  }
}
