/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-resume
 *
 * POST /api/kody/brain/resume
 *
 * Wake a suspended/stopped Brain machine. Idempotent — returns 200 when
 * already running or when no machine exists. Pairs with /api/kody/brain/suspend
 * for the user-initiated pause/resume toggle in Settings.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { readBrainApp } from "@dashboard/lib/brain/store";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { resumeBrain } from "@dashboard/lib/runners/brain-fly";
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
        "brain resume: stored record read failed (non-fatal)",
      );
    }

    await resumeBrain({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      ...(storedAppName ? { appNameOverride: storedAppName } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain resume failed");
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearGitHubContext();
  }
}
