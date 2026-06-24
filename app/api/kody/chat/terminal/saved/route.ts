/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern saved-terminal-snapshots
 *
 * GET /api/kody/chat/terminal/saved
 * POST /api/kody/chat/terminal/saved
 *
 * Lists and saves per-actor terminal snapshots in the configured Kody state repo.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import {
  readSavedTerminalSessions,
  upsertSavedTerminalSession,
} from "@dashboard/lib/terminal/saved-session-store";
import {
  SAVED_TERMINAL_NAME_LIMIT,
  SAVED_TERMINAL_OUTPUT_LIMIT,
} from "@dashboard/lib/terminal/saved-session-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TransportSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("local"),
    sandboxId: z.string().min(1).max(80).optional(),
    label: z.string().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal("github-actions"),
    sandboxId: z.string().min(1).max(80),
    label: z.string().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal("fly"),
    app: z.string().min(1).max(120),
    machineId: z.string().min(1).max(120),
    label: z.string().min(1).max(120).optional(),
  }),
]);

const SaveBody = z.object({
  actorLogin: z.string().trim().optional(),
  id: z.string().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(SAVED_TERMINAL_NAME_LIMIT),
  transport: TransportSchema,
  chatSessionId: z.string().min(1).max(160),
  cwd: z.string().max(1024).optional(),
  shell: z.string().max(160).optional(),
  output: z.string().max(SAVED_TERMINAL_OUTPUT_LIMIT).optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const actorResult = await verifyActorLogin(
    req,
    req.nextUrl.searchParams.get("actorLogin") ?? undefined,
  );
  if (actorResult instanceof NextResponse) return actorResult;

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  try {
    const { doc } = await readSavedTerminalSessions(
      octokit,
      auth.owner,
      auth.repo,
      actorResult.identity.login,
    );
    return NextResponse.json({ sessions: doc.sessions });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "saved-terminal-sessions: read failed",
    );
    return NextResponse.json(
      { error: "saved_terminal_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

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

  const parsed = SaveBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
  if (actorResult instanceof NextResponse) return actorResult;

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  try {
    const result = await upsertSavedTerminalSession(
      octokit,
      auth.owner,
      auth.repo,
      actorResult.identity.login,
      {
        id: parsed.data.id,
        name: parsed.data.name,
        transport: parsed.data.transport,
        chatSessionId: parsed.data.chatSessionId,
        cwd: parsed.data.cwd,
        shell: parsed.data.shell,
        output: parsed.data.output,
      },
    );
    return NextResponse.json({
      ok: true,
      session: result.session,
      sessions: result.doc.sessions,
    });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "saved-terminal-sessions: write failed",
    );
    return NextResponse.json(
      { error: "saved_terminal_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
