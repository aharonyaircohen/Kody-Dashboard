/**
 * @fileType api-endpoint
 * @domain runner
 * @pattern fly-activity-api
 *
 * GET /api/kody/fly/activity — per-machine activity history for the connected
 * repo: working time span, uptime %, suspend count, and estimated cost,
 * computed from snapshots we record in the configured Kody state repo.
 *
 * Each call opportunistically records a fresh snapshot (throttled to ≥5 min in
 * the store), so simply viewing this view keeps the timeline ticking — no cron,
 * no DB (GitHub-only, per the dashboard's infra rule).
 *
 * Auth: requireKodyAuth. Fly token: the connected repo's vault FLY_API_TOKEN.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import {
  flyConfigFromContext,
  resolveFlyContext,
} from "@dashboard/lib/runners/fly-context";
import { computeActivity } from "@dashboard/lib/runners/fly-activity";
import {
  readActivityFile,
  recordSnapshot,
  snapshotFromInventory,
} from "@dashboard/lib/runners/fly-activity-store";
import { listFlyInventory } from "@dashboard/lib/runners/fly-inventory";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const cfg = flyConfigFromContext(ctx.context);
  if (!cfg) {
    return NextResponse.json(
      {
        error: "fly_token_missing",
        message: "FLY_API_TOKEN not in this repo's secrets vault.",
      },
      { status: 503 },
    );
  }

  try {
    // Record a fresh snapshot (throttled in the store), then compute from the
    // full timeline including it. A snapshot/read failure shouldn't blank the
    // view, so the record step is best-effort.
    const inventory = await listFlyInventory(cfg);
    const now = Date.now();
    try {
      await recordSnapshot(
        ctx.context.octokit,
        ctx.context.owner,
        ctx.context.repo,
        snapshotFromInventory(inventory, now),
      );
    } catch (err) {
      logger.warn(
        { err, owner: ctx.context.owner, repo: ctx.context.repo },
        "fly-activity: snapshot record failed (non-fatal)",
      );
    }

    const file = await readActivityFile(
      ctx.context.octokit,
      ctx.context.owner,
      ctx.context.repo,
    );
    const activity = computeActivity(file);
    return NextResponse.json({
      activity,
      snapshots: file.snapshots.length,
      now,
    });
  } catch (err) {
    logger.error(
      { err, owner: ctx.context.owner, repo: ctx.context.repo },
      "fly-activity: failed",
    );
    return NextResponse.json(
      { error: "activity_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
