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

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
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

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  const cfg = await resolvePreviewConfigForOctokit({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
  });
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
        octokit,
        auth.owner,
        auth.repo,
        snapshotFromInventory(inventory, now),
      );
    } catch (err) {
      logger.warn(
        { err, owner: auth.owner, repo: auth.repo },
        "fly-activity: snapshot record failed (non-fatal)",
      );
    }

    const file = await readActivityFile(octokit, auth.owner, auth.repo);
    const activity = computeActivity(file);
    return NextResponse.json({
      activity,
      snapshots: file.snapshots.length,
      now,
    });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "fly-activity: failed",
    );
    return NextResponse.json(
      { error: "activity_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
