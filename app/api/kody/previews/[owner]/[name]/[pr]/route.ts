/**
 * @fileType api-endpoint
 * @domain previews
 * @pattern preview-status-api
 *
 * GET    /api/kody/previews/:owner/:name/:pr — current preview status + URL.
 * DELETE /api/kody/previews/:owner/:name/:pr — destroy the preview (PR closed).
 *
 * Both endpoints resolve the preview's Fly config from the target repo's
 * vault — not the operator's connected repo. Destroy is idempotent.
 */

import { NextRequest, NextResponse } from "next/server";

import { getUserOctokit, requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
import {
  destroyPreview,
  getPreview,
} from "@dashboard/lib/previews/preview-lifecycle";

export const runtime = "nodejs";

type Params = { params: Promise<{ owner: string; name: string; pr: string }> };

async function resolveCfg(
  req: NextRequest,
  owner: string,
  name: string,
) {
  const octokit = await getUserOctokit(req);
  if (!octokit) return null;
  return resolvePreviewConfigForOctokit({ octokit, owner, repo: name });
}

export async function GET(req: NextRequest, ctx: Params) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const { owner, name, pr } = await ctx.params;
  const prNum = Number(pr);
  if (!Number.isFinite(prNum) || prNum <= 0) {
    return NextResponse.json({ error: "bad_pr" }, { status: 400 });
  }

  const cfg = await resolveCfg(req, owner, name);
  if (!cfg) {
    return NextResponse.json(
      { error: "fly_token_missing" },
      { status: 503 },
    );
  }

  try {
    const info = await getPreview({ repo: `${owner}/${name}`, pr: prNum }, cfg);
    if (!info) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(info);
  } catch (err) {
    logger.error({ err, owner, name, pr }, "previews: status failed");
    return NextResponse.json(
      { error: "status_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, ctx: Params) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const { owner, name, pr } = await ctx.params;
  const prNum = Number(pr);
  if (!Number.isFinite(prNum) || prNum <= 0) {
    return NextResponse.json({ error: "bad_pr" }, { status: 400 });
  }

  const cfg = await resolveCfg(req, owner, name);
  if (!cfg) {
    return NextResponse.json(
      { error: "fly_token_missing" },
      { status: 503 },
    );
  }

  try {
    await destroyPreview({ repo: `${owner}/${name}`, pr: prNum }, cfg);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, owner, name, pr }, "previews: destroy failed");
    return NextResponse.json(
      { error: "destroy_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
