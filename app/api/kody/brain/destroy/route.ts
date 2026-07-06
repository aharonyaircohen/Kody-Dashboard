/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-destroy
 *
 * POST /api/kody/brain/destroy
 *
 * Tear down the per-user Brain Fly app + all machines under it. Idempotent —
 * returns 200 even if nothing exists. On success, also clears the per-user
 * brain record at state-repo root `users/<login>/data/brain.json` so the Runner page
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
import { manageBrainServer } from "@dashboard/lib/brain/server-commands";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
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

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    return NextResponse.json(
      await manageBrainServer({ command: "destroy", context: ctx.context }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain destroy failed");
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearGitHubContext();
  }
}
