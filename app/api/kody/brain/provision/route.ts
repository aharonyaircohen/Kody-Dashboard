/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-provision
 *
 * POST /api/kody/brain/provision
 *
 * Idempotent provision of the per-user Brain Fly app. Drives the
 * Settings "Brain on Fly" toggle — the user flips it ON and we create
 * (or reuse) the app + machine. Returns the same shape as the chat
 * route's internal provisionBrain call.
 *
 * Auth: requireKodyAuth. Reads FLY_API_TOKEN from the repo secrets vault.
 *
 * The chat route /api/kody/chat/brain-fly still calls provisionBrain
 * directly as a safety net (idempotent), so this route is purely for
 * the user-initiated path from Settings.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { provisionBrain } from "@dashboard/lib/runners/brain-fly";
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
          "Brain on Fly needs a Fly Machines token — add FLY_API_TOKEN to the repo Secrets vault.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await provisionBrain({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      repo: `${ctx.context.owner}/${ctx.context.repo}`,
      githubToken: ctx.context.githubToken,
      allSecrets: ctx.context.allSecrets,
      perfTier: ctx.context.perfTier,
      litellmUrl: ctx.context.litellmUrl,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain provision failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
