/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-status
 *
 * GET /api/kody/brain/status
 *
 * Read-only state of the per-user Brain Fly app for the connected repo.
 * Drives the BrainFlyStatusBar pill in the chat panel.
 *
 * Returns:
 *   { state: 'off' }                              — no Fly token, or no app yet.
 *   { state: 'running'|'suspended'|'stopped',
 *     app, url, machineId? }                      — live machine state.
 *
 * Provision lives in the chat route (POST /api/kody/chat/brain-fly) — the
 * first message provisions and resumes. This endpoint never mutates Fly.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { brainStatus } from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    // No Fly token in the vault — the user can't have a brain app yet.
    return NextResponse.json({ state: "off" });
  }

  try {
    const result = await brainStatus({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain status failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
