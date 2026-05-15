/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern multi-repo-add
 *
 * POST /api/kody/repos/add
 *
 * Validates a user-supplied GitHub PAT against `GET /repos/{owner}/{repo}` and
 * (best-effort) registers the dashboard's webhook on that repo. Used by the
 * `/repos` page when a user adds a new repository to the dashboard.
 *
 * Body: { owner: string, repo: string, token: string }
 *
 * The PAT is *not* stored server-side — the client persists it in
 * localStorage alongside the rest of `kody_auth`. This endpoint only proves
 * the PAT works and ensures push-based cache invalidation is wired up.
 *
 * Webhook registration failure does not fail the request — polling still
 * works as a fallback. The response includes `webhook.ok` so the UI can
 * surface the partial state.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";
import { ensureWebhook } from "@dashboard/lib/webhooks/register";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AddRepoBody {
  owner?: string;
  repo?: string;
  token?: string;
}

interface AddRepoResponse {
  ok: boolean;
  owner: string;
  repo: string;
  /** Repo metadata returned by GitHub (subset). */
  repository: {
    fullName: string;
    private: boolean;
    defaultBranch: string;
    htmlUrl: string;
  };
  /**
   * Basic identity of the token's owner. Returned so the dashboard can
   * bootstrap a fresh `kody_auth` object when this is the first repo
   * added (no separate "login" step exists). Subsequent adds simply
   * ignore this field.
   */
  user: {
    login: string;
    avatar_url: string;
    id: number;
  };
  webhook: {
    ok: boolean;
    created?: boolean;
    error?: string;
  };
}

const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: AddRepoBody;
  try {
    body = (await req.json()) as AddRepoBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  const token = body.token?.trim();

  if (!owner || !repo || !token) {
    return NextResponse.json(
      {
        error: "missing_fields",
        message: "owner, repo, and token are required",
      },
      { status: 400 },
    );
  }

  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
    return NextResponse.json(
      { error: "invalid_owner_or_repo" },
      { status: 400 },
    );
  }

  // 1) Validate the PAT by hitting GET /repos/{owner}/{repo}.
  let repoData: {
    full_name: string;
    private: boolean;
    default_branch: string;
    html_url: string;
  };
  try {
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (ghRes.status === 401) {
      return NextResponse.json(
        {
          error: "invalid_token",
          message:
            "GitHub rejected the token (401). Check the PAT and try again.",
        },
        { status: 401 },
      );
    }
    if (ghRes.status === 404) {
      return NextResponse.json(
        {
          error: "repo_not_found",
          message:
            "Repo not found, or the token has no access. Make sure the PAT has `repo` scope and can see this repository.",
        },
        { status: 404 },
      );
    }
    if (ghRes.status === 403) {
      return NextResponse.json(
        {
          error: "forbidden",
          message:
            "GitHub returned 403. The token may be missing required scopes.",
        },
        { status: 403 },
      );
    }
    if (!ghRes.ok) {
      return NextResponse.json(
        { error: "github_error", status: ghRes.status },
        { status: 502 },
      );
    }

    repoData = (await ghRes.json()) as typeof repoData;
  } catch (err) {
    logger.warn(
      { event: "repo_validate_network_error", owner, repo, err: String(err) },
      "Network error validating repo",
    );
    return NextResponse.json({ error: "network_error" }, { status: 502 });
  }

  // 1b) Fetch the token owner's basic identity. Needed so the client can
  // bootstrap a fresh kody_auth object when this is the first repo added.
  let userData: { login: string; avatar_url: string; id: number };
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!userRes.ok) {
      return NextResponse.json(
        { error: "user_lookup_failed", status: userRes.status },
        { status: 502 },
      );
    }
    userData = (await userRes.json()) as typeof userData;
  } catch (err) {
    logger.warn(
      { event: "user_lookup_network_error", owner, repo, err: String(err) },
      "Network error fetching token owner",
    );
    return NextResponse.json({ error: "network_error" }, { status: 502 });
  }

  // 2) Best-effort webhook registration. Failure is non-fatal — polling still works.
  const hookUrl = `${getPublicBaseUrl(req)}/api/webhooks/github`;
  let webhook: AddRepoResponse["webhook"] = { ok: false };
  try {
    const result = await ensureWebhook({ token, owner, repo, hookUrl });
    if (result.ok) {
      webhook = { ok: true, created: result.created };
      logger.info(
        {
          event: "webhook_registered_added_repo",
          hookId: result.hookId,
          created: result.created,
          owner,
          repo,
        },
        "Webhook registered for added repo",
      );
    } else {
      webhook = { ok: false, error: result.error };
      logger.info(
        {
          event: "webhook_register_failed_added_repo",
          owner,
          repo,
          status: result.status,
          error: result.error,
        },
        "Webhook registration failed for added repo (non-fatal)",
      );
    }
  } catch (err) {
    webhook = { ok: false, error: String(err) };
  }

  const response: AddRepoResponse = {
    ok: true,
    owner,
    repo,
    repository: {
      fullName: repoData.full_name,
      private: repoData.private,
      defaultBranch: repoData.default_branch,
      htmlUrl: repoData.html_url,
    },
    user: {
      login: userData.login,
      avatar_url: userData.avatar_url,
      id: userData.id,
    },
    webhook,
  };

  return NextResponse.json(response, { status: 200 });
}
