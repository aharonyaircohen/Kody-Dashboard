/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-destroy
 *
 * POST /api/kody/brain/destroy
 *
 * Tear down the per-user Brain Fly app + all machines under it. Idempotent —
 * returns 200 even if nothing exists. On success, also clears the per-user
 * brain record at `users/<login>/data/brain.json` so the Runner page
 * stops showing the destroyed app.
 *
 * If Fly is unreachable (e.g. the token's org no longer matches the app's
 * org), the storage record is preserved — the user needs the separate
 * "Delete record" affordance to wipe it. This route surfaces the Fly error
 * in that case so the user knows the Fly app may still exist somewhere.
 *
 * Lives separately from the chat route so the BrainFlyStatusBar can offer
 * an explicit off switch. The next chat message will re-provision from
 * scratch.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { clearBrainApp, readBrainApp } from "@dashboard/lib/brain/store";
import { logger } from "@dashboard/lib/logger";
import { destroyBrain } from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Fly token missing — add FLY_API_TOKEN to the repo Secrets vault.",
      },
      { status: 400 },
    );
  }

  // If the dashboard has a stored record for this user, the Fly app may
  // be living under a `-2`/`-3` suffix from a previous auto-rename. Read
  // the record and pass the actual app name to destroyBrain so we don't
  // target a default name that the token can't see. Best-effort: if the
  // read fails we fall back to the default name and let Fly respond.
  let storedAppName: string | undefined;
  try {
    const stored = await readBrainApp(
      ctx.context.account,
      ctx.context.githubToken,
    );
    storedAppName = stored?.appName;
  } catch (readErr) {
    logger.warn(
      { err: readErr, owner: ctx.context.owner },
      "brain destroy: stored record read failed (non-fatal)",
    );
  }

  try {
    await destroyBrain({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      ...(storedAppName ? { appNameOverride: storedAppName } : {}),
    });
    try {
      await clearBrainApp(ctx.context.account, ctx.context.githubToken);
    } catch (clearErr) {
      logger.warn(
        { err: clearErr, owner: ctx.context.owner },
        "brain destroy: record clear failed (non-fatal)",
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain destroy failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
