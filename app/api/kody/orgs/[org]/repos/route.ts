/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern org-repos-api
 * @ai-summary Org workspace repository API. Lists GitHub repositories
 * owned by the selected GitHub owner and creates new repos under either
 * the authenticated user account or an org the token can administer.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";
import { logger } from "@dashboard/lib/logger";
import { ensureWebhook } from "@dashboard/lib/webhooks/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/;

interface GithubRepo {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  owner?: { login?: string };
}

interface GithubUser {
  login: string;
  avatar_url: string;
  id: number;
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function toRepository(repo: GithubRepo) {
  return {
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
    owner: repo.owner?.login ?? repo.full_name.split("/")[0],
  };
}

async function readGithubJson<T>(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const response = await fetch(url, init);
  if (!response.ok) return { ok: false, response };
  return { ok: true, data: (await response.json()) as T };
}

function githubError(response: Response, fallback: string) {
  if (response.status === 401) {
    return NextResponse.json(
      {
        error: "invalid_token",
        message: "GitHub rejected token (401). Check PAT and try again.",
      },
      { status: 401 },
    );
  }

  if (response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const retryAfter = response.headers.get("retry-after");
    const resetEpoch = Number(response.headers.get("x-ratelimit-reset"));
    const rateLimited = remaining === "0" || !!retryAfter;

    if (rateLimited) {
      const resetMs =
        Number.isFinite(resetEpoch) && resetEpoch > 0
          ? resetEpoch * 1000
          : retryAfter
            ? Date.now() + Number(retryAfter) * 1000
            : null;
      return NextResponse.json(
        {
          error: "rate_limited",
          message: resetMs
            ? `GitHub rate limit hit. Try again after ${new Date(resetMs).toISOString()}.`
            : "GitHub rate limit hit. Try again after the limit resets.",
          ...(resetMs ? { resetAt: new Date(resetMs).toISOString() } : {}),
        },
        { status: 429 },
      );
    }

    return NextResponse.json(
      {
        error: "forbidden",
        message:
          "GitHub returned 403. Token may be missing repo creation or repo access permissions.",
      },
      { status: 403 },
    );
  }

  if (response.status === 404) {
    return NextResponse.json(
      {
        error: "not_found",
        message:
          "GitHub owner or repository not found, or token has no access.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { error: "github_error", message: fallback, status: response.status },
    { status: 502 },
  );
}

async function resolveOrg(params: Promise<{ org: string }>) {
  const { org } = await params;
  const owner = decodeURIComponent(org).trim();
  return owner;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ org: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      { error: "request_auth_required" },
      { status: 401 },
    );
  }

  const org = await resolveOrg(params);
  if (!OWNER_RE.test(org)) {
    return NextResponse.json({ error: "invalid_org" }, { status: 400 });
  }

  try {
    const url =
      "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member";
    const result = await readGithubJson<GithubRepo[]>(url, {
      headers: githubHeaders(headerAuth.token),
      cache: "no-store",
    });
    if (!result.ok) return githubError(result.response, "Failed to list repos");

    const orgLower = org.toLowerCase();
    const repositories = result.data
      .filter((repo) => (repo.owner?.login ?? "").toLowerCase() === orgLower)
      .map(toRepository)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ org, repositories });
  } catch (err) {
    logger.warn({ event: "org_repos_list_failed", org, err: String(err) });
    return NextResponse.json({ error: "network_error" }, { status: 502 });
  }
}

const createRepoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(350).optional(),
  private: z.boolean().default(true),
  autoInit: z.boolean().default(true),
  gitignoreTemplate: z.string().min(1).max(100).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ org: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      { error: "request_auth_required" },
      { status: 401 },
    );
  }

  const org = await resolveOrg(params);
  if (!OWNER_RE.test(org)) {
    return NextResponse.json({ error: "invalid_org" }, { status: 400 });
  }

  const parsed = createRepoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_repo", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const name = parsed.data.name.trim();
  if (!REPO_RE.test(name)) {
    return NextResponse.json({ error: "invalid_repo_name" }, { status: 400 });
  }

  try {
    const userResult = await readGithubJson<GithubUser>(
      "https://api.github.com/user",
      { headers: githubHeaders(headerAuth.token), cache: "no-store" },
    );
    if (!userResult.ok) {
      return githubError(userResult.response, "Failed to read token owner");
    }

    const endpoint =
      userResult.data.login.toLowerCase() === org.toLowerCase()
        ? "https://api.github.com/user/repos"
        : `https://api.github.com/orgs/${org}/repos`;

    const createResult = await readGithubJson<GithubRepo>(endpoint, {
      method: "POST",
      headers: {
        ...githubHeaders(headerAuth.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        description: parsed.data.description?.trim() || undefined,
        private: parsed.data.private,
        auto_init: parsed.data.autoInit,
        gitignore_template: parsed.data.gitignoreTemplate,
      }),
    });
    if (!createResult.ok) {
      return githubError(createResult.response, "Failed to create repository");
    }

    const repository = toRepository(createResult.data);
    const hookUrl = `${getPublicBaseUrl(req)}/api/webhooks/github`;
    let webhook: { ok: boolean; created?: boolean; error?: string } = {
      ok: false,
    };

    try {
      const result = await ensureWebhook({
        token: headerAuth.token,
        owner: repository.owner,
        repo: repository.name,
        hookUrl,
      });
      webhook = result.ok
        ? { ok: true, created: result.created }
        : { ok: false, error: result.error };
    } catch (err) {
      webhook = { ok: false, error: String(err) };
    }

    return NextResponse.json(
      {
        ok: true,
        org,
        repository,
        user: {
          login: userResult.data.login,
          avatar_url: userResult.data.avatar_url,
          id: userResult.data.id,
        },
        webhook,
      },
      { status: 201 },
    );
  } catch (err) {
    logger.warn({ event: "org_repos_create_failed", org, err: String(err) });
    return NextResponse.json({ error: "network_error" }, { status: 502 });
  }
}
