/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-status
 *
 * GET /api/kody/brain/status
 *
 * Read-only state of the per-user Brain Fly app for the connected repo.
 * Drives the BrainFlyStatusBar pill in the chat panel and the Runner page.
 *
 * Returns:
 *   { state: 'off' }                                    — no Fly token, no app yet.
 *   { state: 'running'|'suspended'|'stopped',
 *     app, url, machineId?, stored? }                   — live machine state.
 *
 * `stored` is the per-user record at
 * `.kody/users/<login>/data/brain.json` (see `brain/store.ts`). It can
 * outlive the user's access to the app on Fly (token revoked, app moved
 * orgs, slug taken by another account) — in that case `state` is `off`
 * and `stored` is non-null, which the Runner page surfaces as an orphan
 * with a "Delete record" affordance.
 *
 * Provision lives in the chat route (POST /api/kody/chat/brain-fly) — the
 * first message provisions and resumes. This endpoint never mutates Fly.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { readBrainApp } from "@dashboard/lib/brain/store";
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
    return NextResponse.json({ state: "off", stored: null });
  }

  // Read the stored record first so the live-status call targets the
  // actual app name (which may carry a `-2`/`-3` suffix from an earlier
  // auto-rename when the default slug was taken).
  let storedAppName: string | undefined;
  let storedRecord: Awaited<ReturnType<typeof readBrainApp>> = null;
  try {
    storedRecord = await readBrainApp(
      ctx.context.account,
      ctx.context.githubToken,
    );
    storedAppName = storedRecord?.appName;
  } catch (err) {
    logger.warn(
      { err, owner: ctx.context.owner },
      "brain status: stored record read failed (non-fatal)",
    );
  }

  try {
    const result = await brainStatus({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      ...(storedAppName ? { appNameOverride: storedAppName } : {}),
    });
    return NextResponse.json({ ...result, stored: storedRecord });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain status failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
