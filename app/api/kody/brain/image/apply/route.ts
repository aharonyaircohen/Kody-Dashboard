/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-image-apply-route
 *
 * POST /api/kody/brain/image/apply applies the selected Brain image to the
 * user's Fly Brain. Selection remains metadata-only; this route owns runtime
 * mutation.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { applyBrainImage } from "@dashboard/lib/brain/image-apply-command";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import { requestOrigin } from "@dashboard/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ApplyBody {
  imageRef?: string;
}

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
          "Brain image apply needs a Fly Machines token. Add FLY_API_TOKEN to the repo Secrets vault.",
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
    const body = (await req.json().catch(() => ({}))) as ApplyBody;
    const result = await applyBrainImage({
      context: ctx.context,
      dashboardUrl: requestOrigin(req),
      imageRef: body.imageRef,
    });
    return NextResponse.json({
      ok: true,
      imageRef:
        result.runtime.desiredImageRef ??
        result.runtime.running?.imageRef ??
        null,
      runningImageRef: result.runtime.running?.imageRef ?? null,
      runningAt: result.runtime.running?.appliedAt ?? null,
      runningApp: result.runtime.running?.app ?? null,
      runningMachineId: result.runtime.running?.machineId ?? null,
      runtime: result.runtime,
      images: result.image.images,
      brain: {
        app: result.brain.app,
        machineId: result.brain.machineId,
        url: result.brain.url,
        org: result.brain.org,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, owner: ctx.context.owner, repo: ctx.context.repo },
      "brain image apply failed",
    );
    return NextResponse.json(
      { error: "brain_image_apply_failed", message },
      { status: 502 },
    );
  } finally {
    clearGitHubContext();
  }
}
