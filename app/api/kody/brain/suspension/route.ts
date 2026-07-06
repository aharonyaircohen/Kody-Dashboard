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
import {
  BrainCommandError,
  manageBrainServer,
} from "@dashboard/lib/brain/server-commands";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
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
    const result = await manageBrainServer({
      command: "update-suspension",
      context: ctx.context,
      suspendOnIdle,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain suspension failed");
    if (err instanceof BrainCommandError) {
      return NextResponse.json({ error: message }, { status: err.status });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearGitHubContext();
  }
}
