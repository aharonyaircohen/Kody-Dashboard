/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-suspension
 *
 * POST /api/kody/brain/suspension
 *
 * Update the idle auto-suspension policy on the stored Brain Fly machine.
 * This route intentionally updates an existing machine only; Turn on remains
 * the only path that may provision a Brain app.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { resolveBrainService } from "@dashboard/lib/brain/service-resolver";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { updateBrainSuspension } from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";

export const runtime = "nodejs";

function brainSuspendOnIdleFrom(req: NextRequest): boolean | null {
  const raw = req.headers.get("x-kody-brain-suspension");
  if (raw === "never") return false;
  if (raw === "auto") return true;
  return null;
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const suspendOnIdle = brainSuspendOnIdleFrom(req);
  if (suspendOnIdle === null) {
    return NextResponse.json(
      { error: "Brain suspension must be 'auto' or 'never'." },
      { status: 400 },
    );
  }

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Fly token missing - add FLY_API_TOKEN to the repo Secrets vault.",
      },
      { status: 400 },
    );
  }

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    const brain = await resolveBrainService({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      githubToken: ctx.context.githubToken,
      orgSlug: ctx.context.flyOrgSlug,
      defaultRegion: ctx.context.flyDefaultRegion,
    });

    if (brain.state === "off" || !brain.machineId) {
      return NextResponse.json(
        {
          error:
            "Brain is not on yet. Turn it on before changing suspension.",
        },
        { status: 409 },
      );
    }

    const result = await updateBrainSuspension({
      flyToken: brain.flyToken,
      account: ctx.context.account,
      orgSlug: brain.orgSlug,
      defaultRegion: ctx.context.flyDefaultRegion,
      appNameOverride: brain.app,
      machineIdOverride: brain.machineId,
      suspendOnIdle,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain suspension failed");
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearGitHubContext();
  }
}
