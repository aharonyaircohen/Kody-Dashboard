/**
 * @fileType api-endpoint
 * @domain previews
 * @pattern previews-api
 *
 * POST /api/kody/previews — create or refresh a PR preview. Tries the
 * warm pool first, falls back to create-fresh. Auth: standard
 * requireKodyAuth (operator session); the consumer-repo CI calls this
 * via the dashboard's bot token in the build workflow.
 *
 * Body:
 *   { repo: "owner/name", pr: number, image: string,
 *     internalPort?: number, env?: Record<string,string>, region?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
import { createPreview } from "@dashboard/lib/previews/preview-lifecycle";

export const runtime = "nodejs";

const Body = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "repo must be owner/name"),
  pr: z.number().int().positive(),
  image: z.string().min(1),
  internalPort: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  region: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // The vault lookup must use the TARGET repo (from the body), not the
  // operator's connected repo — the bill goes to the repo being previewed.
  const [owner, repo] = parsed.data.repo.split("/") as [string, string];

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  const cfg = await resolvePreviewConfigForOctokit({ octokit, owner, repo });
  if (!cfg) {
    return NextResponse.json(
      {
        error: "fly_token_missing",
        message:
          "FLY_API_TOKEN not in this repo's secrets vault and no FLY_API_TOKEN env fallback.",
      },
      { status: 503 },
    );
  }

  try {
    const info = await createPreview(parsed.data, cfg);
    return NextResponse.json(info, { status: 201 });
  } catch (err) {
    logger.error({ err, body: parsed.data }, "previews: create failed");
    return NextResponse.json(
      { error: "create_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
