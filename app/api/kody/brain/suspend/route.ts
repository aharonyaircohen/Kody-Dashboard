/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-suspend
 *
 * POST /api/kody/brain/suspend
 *
 * Snapshot-pause the per-user Brain Fly machine. Idempotent — returns 200
 * when no machine exists or it's already suspended. Resume happens either
 * via the Settings Resume button (POST /api/kody/brain/resume) or
 * automatically on the next chat request (autostart=true on the service).
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { suspendBrain } from "@dashboard/lib/runners/brain-fly";
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

  try {
    await suspendBrain({
      flyToken: ctx.context.flyToken,
      owner: ctx.context.owner,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain suspend failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
