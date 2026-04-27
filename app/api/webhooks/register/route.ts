/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern github-webhook-registration
 *
 * POST /api/webhooks/register
 *
 * Idempotently registers a GitHub repo webhook pointing at this dashboard's
 * /api/webhooks/github endpoint. Required scopes on the caller's PAT:
 * `admin:repo_hook` (the classic `repo` scope already includes it).
 *
 * Body (optional):
 *   { owner?: string, repo?: string, events?: string[] }
 * Defaults to the connected repo from session and the standard event set.
 *
 * Returns:
 *   { ok: true, hookId: number, created: boolean, url: string }
 *
 * If a hook pointing at our URL already exists, it is reused (created: false)
 * and PATCHed to ensure it carries the current secret + event list.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyKodySession } from "@dashboard/lib/auth/kody_session";
import { GITHUB_OWNER, GITHUB_REPO } from "@dashboard/lib/constants";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "workflow_run",
  "workflow_job",
  "check_run",
  "check_suite",
  "push",
  "create",
  "delete",
];

interface GitHubHook {
  id: number;
  config?: { url?: string };
}

async function gh(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.KODY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "KODY_WEBHOOK_SECRET not configured" },
      { status: 503 },
    );
  }

  const session = await verifyKodySession(req);
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const token = session.ghToken;
  if (!token) {
    return NextResponse.json(
      { error: "session has no GitHub token; re-login" },
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

  const owner = body.owner?.trim() || GITHUB_OWNER;
  const repo = body.repo?.trim() || GITHUB_REPO;
  const events = body.events?.length ? body.events : DEFAULT_EVENTS;

  const baseUrl = getPublicBaseUrl(req);
  const hookUrl = `${baseUrl}/api/webhooks/github`;

  // 1) List existing hooks, look for one pointing at us.
  const listRes = await gh(token, `/repos/${owner}/${repo}/hooks`);
  if (!listRes.ok) {
    const text = await listRes.text();
    logger.error(
      { event: "webhook_list_failed", status: listRes.status, owner, repo },
      "Failed to list webhooks",
    );
    return NextResponse.json(
      { error: "list hooks failed", status: listRes.status, detail: text.slice(0, 500) },
      { status: listRes.status === 403 || listRes.status === 404 ? listRes.status : 502 },
    );
  }
  const hooks = (await listRes.json()) as GitHubHook[];
  const existing = hooks.find((h) => h?.config?.url === hookUrl);

  const desiredConfig = {
    url: hookUrl,
    content_type: "json",
    secret,
    insecure_ssl: "0",
  };

  // 2a) Update existing hook (refresh secret + events).
  if (existing) {
    const patchRes = await gh(token, `/repos/${owner}/${repo}/hooks/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        active: true,
        events,
        config: desiredConfig,
      }),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text();
      logger.error(
        { event: "webhook_patch_failed", status: patchRes.status, hookId: existing.id },
        "Failed to update webhook",
      );
      return NextResponse.json(
        { error: "patch hook failed", status: patchRes.status, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }
    logger.info(
      { event: "webhook_updated", hookId: existing.id, owner, repo, by: session.login },
      "Webhook updated",
    );
    return NextResponse.json(
      { ok: true, hookId: existing.id, created: false, url: hookUrl },
      { status: 200 },
    );
  }

  // 2b) Create a new hook.
  const createRes = await gh(token, `/repos/${owner}/${repo}/hooks`, {
    method: "POST",
    body: JSON.stringify({
      name: "web",
      active: true,
      events,
      config: desiredConfig,
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    logger.error(
      { event: "webhook_create_failed", status: createRes.status, owner, repo },
      "Failed to create webhook",
    );
    return NextResponse.json(
      { error: "create hook failed", status: createRes.status, detail: text.slice(0, 500) },
      { status: 502 },
    );
  }
  const created = (await createRes.json()) as GitHubHook;
  logger.info(
    { event: "webhook_created", hookId: created.id, owner, repo, by: session.login },
    "Webhook created",
  );
  return NextResponse.json(
    { ok: true, hookId: created.id, created: true, url: hookUrl },
    { status: 201 },
  );
}
