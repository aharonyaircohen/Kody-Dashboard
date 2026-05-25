/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-destroy
 *
 * POST /api/kody/brain/destroy
 *
 * Tear down the per-user Brain Fly app + all machines under it. Idempotent —
 * returns 200 even if nothing exists.
 *
 * Lives separately from the chat route so the BrainFlyStatusBar can offer
 * an explicit off switch. The next chat message will re-provision from
 * scratch.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
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

  try {
    await destroyBrain({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain destroy failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
