/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern saved-terminal-snapshot-delete
 *
 * DELETE /api/kody/chat/terminal/saved/:id
 *
 * Deletes one per-actor terminal snapshot from the configured Kody state repo.
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
import { deleteSavedTerminalSession } from "@dashboard/lib/terminal/saved-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Id = z.string().min(1).max(120);

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const parsedId = Id.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
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
    const result = await deleteSavedTerminalSession(
      octokit,
      auth.owner,
      auth.repo,
      actorResult.identity.login,
      parsedId.data,
    );
    if (!result.deleted) {
      return NextResponse.json(
        { error: "saved_terminal_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, id: parsedId.data },
      "saved-terminal-sessions: delete failed",
    );
    return NextResponse.json(
      {
        error: "saved_terminal_delete_failed",
        message: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
