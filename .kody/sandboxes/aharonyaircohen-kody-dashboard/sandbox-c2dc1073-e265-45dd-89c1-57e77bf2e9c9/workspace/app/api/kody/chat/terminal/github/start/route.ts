/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern github-actions-terminal-start
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { startGitHubActionsTerminalSession } from "@dashboard/lib/terminal/github-actions-terminal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  chatSessionId: z.string().min(1).max(120).optional(),
  sandboxId: z.string().min(1).max(80),
});

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

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

  try {
    const session = await startGitHubActionsTerminalSession(req, auth, parsed.data);
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start GitHub Actions terminal";
    return NextResponse.json(
      { error: "github_terminal_start_failed", message },
      { status: message.includes("not found") ? 404 : 500 },
    );
  }
}
