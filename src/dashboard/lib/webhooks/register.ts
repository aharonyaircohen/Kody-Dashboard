/**
 * @fileType utility
 * @domain kody
 * @pattern github-webhook-registrar
 *
 * Idempotently registers a GitHub repo webhook pointing at the dashboard's
 * /api/webhooks/github endpoint. Safe to call repeatedly — if a hook
 * already points at the URL, it's PATCHed to refresh the events list.
 *
 * When `GITHUB_WEBHOOK_SECRET` or `KODY_WEBHOOK_SECRET` is configured, the
 * hook is registered with that shared secret and deliveries are verified by
 * HMAC. Deployments without a secret keep the legacy IP-gated behavior.
 *
 * Used by:
 * - POST /api/webhooks/register (explicit; user POSTs after login).
 *   The OAuth callback that used to auto-register was removed along with
 *   the OAuth start route — dashboard auth is header-based PAT now.
 */

import { logger } from "@dashboard/lib/logger";

export const DEFAULT_WEBHOOK_EVENTS = [
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
  // Goal-discussion threads — invalidates the goal-discussion cache so
  // comments posted on github.com show up in the dashboard immediately.
  "discussion",
  "discussion_comment",
  // Repo capability changes (Discussions toggled on/off, category renamed).
  "repository",
  // CHANGELOG.md maintenance — promote [Unreleased] on release.published.
  "release",
];

interface GitHubHook {
  id: number;
  config?: { url?: string };
}

export interface EnsureWebhookInput {
  token: string;
  owner: string;
  repo: string;
  hookUrl: string;
  events?: string[];
}

export interface EnsureWebhookResult {
  ok: boolean;
  hookId?: number;
  created?: boolean;
  error?: string;
  status?: number;
}

function getWebhookSecret(): string | undefined {
  return (
    process.env.GITHUB_WEBHOOK_SECRET?.trim() ||
    process.env.KODY_WEBHOOK_SECRET?.trim() ||
    undefined
  );
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

export async function ensureWebhook(
  input: EnsureWebhookInput,
): Promise<EnsureWebhookResult> {
  const { token, owner, repo, hookUrl } = input;
  const events = input.events?.length ? input.events : DEFAULT_WEBHOOK_EVENTS;

  const config = {
    url: hookUrl,
    content_type: "json",
    insecure_ssl: "0",
    ...(getWebhookSecret() ? { secret: getWebhookSecret() } : {}),
  };

  // 1) List hooks; reuse if one already points at us.
  const listRes = await gh(token, `/repos/${owner}/${repo}/hooks`);
  if (!listRes.ok) {
    const detail = await listRes.text();
    logger.warn(
      {
        event: "webhook_list_failed",
        status: listRes.status,
        owner,
        repo,
        detail: detail.slice(0, 300),
      },
      "Failed to list webhooks",
    );
    return { ok: false, error: "list hooks failed", status: listRes.status };
  }

  const hooks = (await listRes.json()) as GitHubHook[];
  // Match by path, not full URL: the dashboard's public URL changes between
  // preview/prod deployments and alias renames, but the receiver path is
  // stable. This keeps a single canonical hook per repo and migrates its
  // `config.url` to whichever deployment registered most recently — instead
  // of stacking a new hook for every URL the user happens to register from.
  const existing = hooks.find((h) => {
    const url = h?.config?.url;
    if (!url) return false;
    try {
      return new URL(url).pathname === "/api/webhooks/github";
    } catch {
      return false;
    }
  });

  // 2a) Update existing hook to refresh events list / clear any legacy secret.
  if (existing) {
    const patchRes = await gh(
      token,
      `/repos/${owner}/${repo}/hooks/${existing.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ active: true, events, config }),
      },
    );
    if (!patchRes.ok) {
      const detail = await patchRes.text();
      logger.warn(
        {
          event: "webhook_patch_failed",
          status: patchRes.status,
          hookId: existing.id,
          detail: detail.slice(0, 300),
        },
        "Failed to update webhook",
      );
      return {
        ok: false,
        error: "patch hook failed",
        status: patchRes.status,
        hookId: existing.id,
      };
    }
    return { ok: true, hookId: existing.id, created: false };
  }

  // 2b) Create a new hook.
  const createRes = await gh(token, `/repos/${owner}/${repo}/hooks`, {
    method: "POST",
    body: JSON.stringify({ name: "web", active: true, events, config }),
  });
  if (!createRes.ok) {
    const detail = await createRes.text();
    logger.warn(
      {
        event: "webhook_create_failed",
        status: createRes.status,
        owner,
        repo,
        detail: detail.slice(0, 300),
      },
      "Failed to create webhook",
    );
    return {
      ok: false,
      error: "create hook failed",
      status: createRes.status,
    };
  }
  const created = (await createRes.json()) as GitHubHook;
  return { ok: true, hookId: created.id, created: true };
}
