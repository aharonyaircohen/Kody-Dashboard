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
  serverProviderConfigFromContext,
  resolveServerProviderContext,
} from "@dashboard/lib/infrastructure/server-context";
import { computeServerProviderActivity } from "@dashboard/lib/infrastructure/server-activity";
import {
  readServerProviderActivityFile,
  recordServerProviderSnapshot,
  snapshotFromServerProviderInventory,
} from "@dashboard/lib/infrastructure/server-activity";
import { listServerProviderInventory } from "@dashboard/lib/infrastructure/server-machines";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveServerProviderContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const cfg = serverProviderConfigFromContext(ctx.context);
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
    const inventory = await listServerProviderInventory(cfg);
    const now = Date.now();
    try {
      await recordServerProviderSnapshot(
        ctx.context.octokit,
        ctx.context.owner,
        ctx.context.repo,
        snapshotFromServerProviderInventory(inventory, now),
      );
    } catch (err) {
      logger.warn(
        { err, owner: ctx.context.owner, repo: ctx.context.repo },
        "fly-activity: snapshot record failed (non-fatal)",
      );
    }

    const file = await readServerProviderActivityFile(
      ctx.context.octokit,
      ctx.context.owner,
      ctx.context.repo,
    );
    const activity = computeServerProviderActivity(file);
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
