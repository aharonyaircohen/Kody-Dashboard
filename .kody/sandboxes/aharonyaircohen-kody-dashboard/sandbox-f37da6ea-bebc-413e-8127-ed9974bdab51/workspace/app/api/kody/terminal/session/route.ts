/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern terminal-session-start
 *
 * POST /api/kody/terminal/session
 *
 * Starts a browser terminal session by ensuring the Fly terminal bridge exists
 * and minting a short-lived encrypted token for it. The Fly token stays
 * encrypted inside that token; the dashboard never returns it as plain JSON.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
import { startMachine } from "@dashboard/lib/previews/fly-previews";
import { listFlyInventory } from "@dashboard/lib/runners/fly-inventory";
import { ensureTerminalBridge } from "@dashboard/lib/terminal/bridge-fly";
import {
  buildTerminalWebSocketUrl,
  findTerminalTargetMachine,
  isTerminalFeatureAllowed,
  isTerminalMachineLive,
  isTerminalMachineStartable,
  selectTerminalTarget,
} from "@dashboard/lib/terminal/session";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  app: z.string().min(1).max(120),
  machineId: z.string().min(1).max(120),
  chatSessionId: z.string().min(1).max(160).optional(),
  resetSession: z.boolean().optional(),
  cols: z.number().int().min(20).max(300).optional(),
  rows: z.number().int().min(8).max(120).optional(),
});

const TARGET_STATUS: Record<string, number> = {
  machine_not_found: 404,
  machine_not_terminal_capable: 403,
  machine_not_running: 409,
};

const TARGET_MESSAGE: Record<string, string> = {
  machine_not_found: "Machine not found.",
  machine_not_terminal_capable:
    "Only runner and Brain machines can open a terminal.",
  machine_not_running: "Machine is still waking up. Try Connect again.",
};

const WAKE_POLL_ATTEMPTS = 10;
const WAKE_POLL_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return NextResponse.json({ error: "fly_token_missing" }, { status: 503 });
  }

  try {
    let inventory = await listFlyInventory(cfg);
    const requested = findTerminalTargetMachine(inventory, parsed.data);
    if (!requested) {
      return NextResponse.json(
        {
          error: "machine_not_found",
          message: TARGET_MESSAGE.machine_not_found,
        },
        { status: TARGET_STATUS.machine_not_found },
      );
    }
    if (!isTerminalFeatureAllowed(requested.feature)) {
      return NextResponse.json(
        {
          error: "machine_not_terminal_capable",
          message: TARGET_MESSAGE.machine_not_terminal_capable,
        },
        { status: TARGET_STATUS.machine_not_terminal_capable },
      );
    }
    if (!isTerminalMachineLive(requested.state)) {
      if (!isTerminalMachineStartable(requested.state)) {
        return NextResponse.json(
          {
            error: "machine_not_running",
            message: TARGET_MESSAGE.machine_not_running,
          },
          { status: TARGET_STATUS.machine_not_running },
        );
      }
      logger.info(
        { app: requested.app, machineId: requested.machineId },
        "terminal: waking runner machine",
      );
      await startMachine(requested.app, requested.machineId, cfg);
      for (let attempt = 0; attempt < WAKE_POLL_ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(WAKE_POLL_INTERVAL_MS);
        inventory = await listFlyInventory(cfg);
        const next = findTerminalTargetMachine(inventory, parsed.data);
        if (next && isTerminalMachineLive(next.state)) break;
      }
    }

    const selected = selectTerminalTarget(inventory, parsed.data);
    if (!selected.ok) {
      return NextResponse.json(
        { error: selected.error, message: TARGET_MESSAGE[selected.error] },
        { status: TARGET_STATUS[selected.error] ?? 400 },
      );
    }

    const bridge = await ensureTerminalBridge(cfg);
    const now = Math.floor(Date.now() / 1000);
    const token = mintTerminalBridgeToken({
      owner: auth.owner,
      repo: auth.repo,
      app: parsed.data.app,
      machineId: parsed.data.machineId,
      chatSessionId: parsed.data.chatSessionId,
      resetSession: parsed.data.resetSession,
      flyToken: cfg.token,
      cols: parsed.data.cols,
      rows: parsed.data.rows,
      now,
      secret: bridge.secret,
    });
    const webSocketUrl = buildTerminalWebSocketUrl(bridge.url, token);

    return NextResponse.json({
      ok: true,
      app: selected.machine.app,
      machineId: selected.machine.machineId,
      label: selected.machine.label,
      bridgeApp: bridge.app,
      expiresAt: new Date((now + 120) * 1000).toISOString(),
      webSocketUrl,
    });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "terminal: session start failed",
    );
    return NextResponse.json(
      { error: "terminal_session_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
