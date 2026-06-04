/**
 * @fileType api-endpoint
 * @domain runner
 * @pattern fly-machines-api
 *
 * GET /api/kody/fly/machines — the operator machine inventory: every
 * kody-managed Fly machine the connected repo's token can see, classified by
 * feature (preview / runner / brain / litellm / builder). Powers the Machines
 * table on /runner.
 *
 * Auth: requireKodyAuth. Fly token: the connected repo's vault FLY_API_TOKEN
 * (same per-repo billing rule as the rest of the Fly surface).
 */
import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
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
    const inventory = await listFlyInventory(cfg);
    return NextResponse.json(inventory);
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "fly-machines: inventory failed",
    );
    return NextResponse.json(
      { error: "inventory_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
