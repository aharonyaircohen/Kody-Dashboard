/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern fly-terminal-status
 *
 * POST /api/kody/terminal/status
 *
 * Checks whether a chat-backed Fly terminal session is still alive.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
import { findTerminalBridge } from "@dashboard/lib/terminal/bridge-fly";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  app: z.string().min(1).max(120),
  machineId: z.string().min(1).max(120),
  chatSessionId: z.string().min(1).max(160),
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

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  const cfg = await resolvePreviewConfigForOctokit({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
  });
  if (!cfg) {
    return NextResponse.json({ ok: true, alive: false });
  }

  const bridge = await findTerminalBridge(cfg);
  if (!bridge) {
    return NextResponse.json({ ok: true, alive: false });
  }

  const token = mintTerminalBridgeToken({
    owner: auth.owner,
    repo: auth.repo,
    app: parsed.data.app,
    machineId: parsed.data.machineId,
    chatSessionId: parsed.data.chatSessionId,
    flyToken: cfg.token,
    ttlSeconds: 30,
    secret: bridge.secret,
  });

  try {
    const statusUrl = new URL("/status", bridge.url);
    statusUrl.searchParams.set("token", token);
    const res = await fetch(statusUrl, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return NextResponse.json({ ok: true, alive: false });
    const data = (await res.json().catch(() => ({}))) as {
      alive?: boolean;
      ready?: boolean;
      socketCount?: number;
      lastTouched?: number | null;
    };
    return NextResponse.json({
      ok: true,
      alive: Boolean(data.alive),
      ready: Boolean(data.ready),
      socketCount: data.socketCount ?? 0,
      lastTouched: data.lastTouched ?? null,
    });
  } catch {
    return NextResponse.json({ ok: true, alive: false });
  }
}
