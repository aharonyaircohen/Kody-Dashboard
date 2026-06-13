/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern github-webhook-registration
 *
 * POST /api/webhooks/register
 *
 * Manual webhook registration entry point. Useful for re-running
 * registration on an already-connected repo, or for targeting a different
 * repo than the dashboard's current view.
 *
 * Body (optional): { owner?: string, repo?: string, events?: string[] }
 * Defaults to the headers' x-kody-owner / x-kody-repo, falling back to
 * the build-time GITHUB_OWNER / GITHUB_REPO constants.
 *
 * Authentication: the same per-request PAT every other dashboard route
 * uses — `x-kody-token` (with optional `x-kody-owner` / `x-kody-repo`).
 * The PAT must have `admin:repo_hook` scope (covered by classic `repo`).
 *
 * No shared secret — webhook deliveries are verified by GitHub source IP
 * (see src/dashboard/lib/webhooks/github-ip.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { GITHUB_OWNER, GITHUB_REPO } from "@dashboard/lib/constants";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";
import { ensureWebhook } from "@dashboard/lib/webhooks/register";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.headers.get("x-kody-token")?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "missing_token", message: "x-kody-token header required" },
      { status: 401 },
    );
  }

  let body: { owner?: string; repo?: string; events?: string[] } = {};
  try {
    if (req.headers.get("content-length") !== "0") {
      body = (await req.json().catch(() => ({}))) as typeof body;
    }
  } catch {
    body = {};
  }

  const owner =
    body.owner?.trim() ||
    req.headers.get("x-kody-owner")?.trim() ||
    GITHUB_OWNER;
  const repo =
    body.repo?.trim() || req.headers.get("x-kody-repo")?.trim() || GITHUB_REPO;
  const hookUrl = `${getPublicBaseUrl(req)}/api/webhooks/github`;

  const result = await ensureWebhook({
    token,
    owner,
    repo,
    hookUrl,
    events: body.events,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, status: result.status },
      {
        status:
          result.status === 403 || result.status === 404 ? result.status : 502,
      },
    );
  }

  logger.info(
    {
      event: "webhook_registered",
      hookId: result.hookId,
      created: result.created,
      owner,
      repo,
    },
    "Webhook registered (manual endpoint)",
  );
  return NextResponse.json(
    { ok: true, hookId: result.hookId, created: result.created, url: hookUrl },
    { status: result.created ? 201 : 200 },
  );
}
