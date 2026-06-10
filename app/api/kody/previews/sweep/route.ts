/**
 * @fileType api-endpoint
 * @domain previews
 * @pattern previews-sweep-api
 *
 * POST /api/kody/previews/sweep — repair preview machines so they sleep/wake
 * on traffic, and destroy connected-repo preview apps past
 * `fly.previews.ttlDays` (kody.config.json). Powers the Fly panel's cleanup
 * button; the preview webhook also runs it opportunistically on each build.
 *
 * Auth: requireKodyAuth (operator session, header PAT, or KODY_BOT_TOKEN).
 * The repo swept is the connected repo (from request auth), and its own Fly
 * token pays for the API calls — same per-repo billing rule as create.
 */

import { NextRequest, NextResponse } from "next/server";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { sweepExpiredPreviews } from "@dashboard/lib/previews/sweep";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const repo = `${auth.owner}/${auth.repo}`;
  try {
    const result = await sweepExpiredPreviews(repo);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    logger.error({ err, repo }, "previews: sweep failed");
    return NextResponse.json(
      { error: "sweep_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
