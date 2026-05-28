/**
 * @fileType api-endpoint
 * @domain previews
 * @pattern previews-api
 *
 * POST /api/kody/previews — create or refresh a PR preview.
 *
 * Dashboard owns the full flow:
 *   1. Resolves Fly token + GitHub token from the target repo's vault
 *   2. Calls kody-preview-builder to clone+build the image
 *   3. Tries the warm pool, falls back to create-fresh
 *
 * Auth: requireKodyAuth (operator session, header PAT, or KODY_BOT_TOKEN).
 *
 * Body:
 *   {
 *     repo: "owner/name",
 *     pr: number,
 *     ref: string,                // branch or sha to build
 *     internalPort?: number,
 *     env?: Record<string,string>,
 *     region?: string
 *   }
 *
 * `image` is accepted for backward-compat (skips the builder when set).
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
  ref: z.string().min(1),
  image: z.string().optional(),
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

  // Vault lookup uses the TARGET repo (from the body) — the bill goes
  // to the repo being previewed.
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
    const info = await createPreview(
      {
        repo: parsed.data.repo,
        pr: parsed.data.pr,
        ref: parsed.data.ref,
        image: parsed.data.image,
        // The operator's PAT lets the builder clone private repos.
        githubToken: auth.token,
        internalPort: parsed.data.internalPort,
        env: parsed.data.env,
        region: parsed.data.region,
      },
      cfg,
    );
    return NextResponse.json(info, { status: 201 });
  } catch (err) {
    logger.error({ err, body: parsed.data }, "previews: create failed");
    return NextResponse.json(
      { error: "create_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
