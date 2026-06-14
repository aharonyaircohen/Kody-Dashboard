/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern github-actions-terminal-input
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { writeGitHubActionsTerminalInput } from "@dashboard/lib/terminal/github-actions-terminal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.string().min(1).max(120),
  input: z.string().min(1).max(20_000),
});

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

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

  try {
    await writeGitHubActionsTerminalInput(req, auth, parsed.data.sessionId, parsed.data.input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to write GitHub Actions terminal input";
    return NextResponse.json({ error: "github_terminal_input_failed", message }, { status: 500 });
  }
}
