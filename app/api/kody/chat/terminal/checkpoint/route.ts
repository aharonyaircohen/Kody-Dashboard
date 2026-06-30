/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern terminal-checkpoints
 *
 * GET/PUT/DELETE /api/kody/chat/terminal/checkpoint
 *
 * Reads, saves, or resets the hidden checkpoint for the current terminal
 * identity. The server computes checkpoint identity; the client only sends the
 * current transport and chat session.
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
  deleteTerminalCheckpoint,
  getTerminalCheckpoint,
  upsertTerminalCheckpoint,
} from "@dashboard/lib/terminal/checkpoint-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TransportSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("local"),
    label: z.string().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal("fly"),
    app: z.string().min(1).max(120),
    machineId: z.string().min(1).max(120),
    label: z.string().min(1).max(120).optional(),
    feature: z.enum(["runner", "brain"]).optional(),
  }),
]);

const LookupSchema = z.object({
  actorLogin: z.string().min(1).max(80).optional(),
  transport: TransportSchema,
  chatSessionId: z.string().min(1).max(160),
});

const UpsertSchema = LookupSchema.extend({
  cwd: z.string().max(1024).optional(),
  shell: z.string().max(160).optional(),
  output: z.string().optional(),
});

function parseTransport(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseLookup(req: NextRequest) {
  return LookupSchema.safeParse({
    actorLogin: req.nextUrl.searchParams.get("actorLogin") ?? undefined,
    chatSessionId: req.nextUrl.searchParams.get("chatSessionId") ?? undefined,
    transport: parseTransport(req.nextUrl.searchParams.get("transport")),
  });
}

async function authContext(req: NextRequest, actorLogin?: string) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const actorResult = await verifyActorLogin(req, actorLogin);
  if (actorResult instanceof NextResponse) return actorResult;

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  return { auth, actor: actorResult.identity, octokit };
}

export async function GET(req: NextRequest) {
  const parsed = parseLookup(req);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_terminal_checkpoint_query" },
      { status: 400 },
    );
  }

  const ctx = await authContext(req, parsed.data.actorLogin);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const result = await getTerminalCheckpoint(
      ctx.octokit,
      ctx.auth.owner,
      ctx.auth.repo,
      ctx.actor.login,
      {
        transport: parsed.data.transport,
        chatSessionId: parsed.data.chatSessionId,
      },
    );
    return NextResponse.json({ checkpoint: result.checkpoint });
  } catch (err) {
    logger.error(
      { err, owner: ctx.auth.owner, repo: ctx.auth.repo },
      "terminal-checkpoints: read failed",
    );
    return NextResponse.json(
      {
        error: "terminal_checkpoint_read_failed",
        message: (err as Error).message,
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const parsed = UpsertSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_terminal_checkpoint_payload" },
      { status: 400 },
    );
  }

  const ctx = await authContext(req, parsed.data.actorLogin);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const result = await upsertTerminalCheckpoint(
      ctx.octokit,
      ctx.auth.owner,
      ctx.auth.repo,
      ctx.actor.login,
      {
        transport: parsed.data.transport,
        chatSessionId: parsed.data.chatSessionId,
        cwd: parsed.data.cwd,
        shell: parsed.data.shell,
        output: parsed.data.output,
      },
    );
    return NextResponse.json({
      ok: true,
      checkpoint: result.checkpoint,
    });
  } catch (err) {
    logger.error(
      { err, owner: ctx.auth.owner, repo: ctx.auth.repo },
      "terminal-checkpoints: write failed",
    );
    return NextResponse.json(
      {
        error: "terminal_checkpoint_write_failed",
        message: (err as Error).message,
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const parsed = parseLookup(req);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_terminal_checkpoint_query" },
      { status: 400 },
    );
  }

  const ctx = await authContext(req, parsed.data.actorLogin);
  if (ctx instanceof NextResponse) return ctx;

  try {
    await deleteTerminalCheckpoint(
      ctx.octokit,
      ctx.auth.owner,
      ctx.auth.repo,
      ctx.actor.login,
      {
        transport: parsed.data.transport,
        chatSessionId: parsed.data.chatSessionId,
      },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error(
      { err, owner: ctx.auth.owner, repo: ctx.auth.repo },
      "terminal-checkpoints: delete failed",
    );
    return NextResponse.json(
      {
        error: "terminal_checkpoint_delete_failed",
        message: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
