/**
 * @fileType utility
 * @domain kody
 * @pattern auth
 * @ai-summary Per-request auth for the Kody Operations Dashboard.
 *
 * Auth priority:
 * 1. Request headers from client (x-kody-token, x-kody-owner, x-kody-repo)
 * 2. Env vars only when a server-only caller opts in explicitly.
 *
 * There is no server-side session: the dashboard stores credentials in
 * localStorage after the user connects a repo, and every API call passes
 * them via the three custom headers above.
 */
import { NextRequest, NextResponse } from "next/server";
import { createUserOctokit } from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import type { Octokit } from "@octokit/rest";

// ─── Header constants (must match auth-context.ts buildAuthHeaders) ─────────────

const HDR_TOKEN = "x-kody-token";
const HDR_OWNER = "x-kody-owner";
const HDR_REPO = "x-kody-repo";
const HDR_STORE_REPO_URL = "x-kody-store-repo-url";
const HDR_STORE_REF = "x-kody-store-ref";

// ─── Per-request auth from headers ────────────────────────────────────────────

export interface RequestAuth {
  token: string;
  owner: string;
  repo: string;
  storeRepoUrl?: string;
  storeRef?: string;
}

/**
 * Extract auth from request headers (set by client from localStorage).
 * Returns null if headers are missing or incomplete.
 */
export function getRequestAuth(req: NextRequest): RequestAuth | null {
  const token = req.headers.get(HDR_TOKEN);
  const owner = req.headers.get(HDR_OWNER);
  const repo = req.headers.get(HDR_REPO);
  const storeRepoUrl = req.headers.get(HDR_STORE_REPO_URL)?.trim() || undefined;
  const storeRef = req.headers.get(HDR_STORE_REF)?.trim() || undefined;

  if (!token || !owner || !repo) return null;
  return { token, owner, repo, storeRepoUrl, storeRef };
}

// ─── Server-side env token (fallback for CI / token-only deployments) ────────

function getEnvToken(): string | null {
  return (
    process.env.KODY_BOT_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_PAT ||
    null
  );
}

// ─── Require auth — 401 unless request auth is present ───────────────────────

export interface KodyAuthOptions {
  allowEnvToken?: boolean;
}

/**
 * Require auth for a route. Checks:
 * 1. x-kody-token header (client localStorage auth)
 * 2. KODY_BOT_TOKEN / GITHUB_TOKEN only when allowEnvToken is true
 *
 * Returns null on success, or a NextResponse on failure.
 */
export async function requireKodyAuth(
  req: NextRequest,
  options: KodyAuthOptions = {},
): Promise<null | NextResponse> {
  const headerAuth = getRequestAuth(req);
  const envToken = options.allowEnvToken ? getEnvToken() : null;

  if (!headerAuth && !envToken) {
    return NextResponse.json(
      {
        message:
          "Not authenticated. Provide x-kody-token, x-kody-owner, and x-kody-repo headers.",
      },
      { status: 401 },
    );
  }
  return null;
}

// ─── Get Octokit instance ──────────────────────────────────────────────────────

/**
 * Get a per-request Octokit instance.
 *
 * Priority:
 * 1. Client token from x-kody-token header (localStorage auth)
 * 2. Env token fallback only when allowEnvToken is true
 *
 * Callers should prefer the header token so operations are attributed
 * to the actual user rather than the bot account.
 */
export async function getUserOctokit(
  req: NextRequest,
  options: KodyAuthOptions = {},
): Promise<Octokit | null> {
  // 1. Client header token (localStorage auth)
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    return createUserOctokit(headerAuth.token);
  }

  // 2. Env token fallback for explicit server-only callers
  const envToken = options.allowEnvToken ? getEnvToken() : null;
  if (envToken) {
    return createUserOctokit(envToken);
  }

  return null;
}

// ─── Verified actor identity (resolve the PAT → its GitHub user) ──────────────

export interface ActorIdentity {
  login: string;
  githubId: number;
  avatarUrl: string;
}

/**
 * Cache resolved identities so audit writes don't spend a `GET /user` call
 * per action. Keyed by a sha256 of the token (never the raw token), so the
 * map can't leak credentials if dumped. Long TTL — a PAT's owner is stable.
 */
const ACTOR_TTL_MS = 60 * 60 * 1000; // 1h
const actorCache = new Map<string, { identity: ActorIdentity; at: number }>();

/**
 * Non-crypto fingerprint (djb2) so the cache never keys on a raw token. Not
 * security-grade — just avoids holding full credentials as Map keys, and
 * keeps this module free of `node:crypto` (auth.ts is reachable from client
 * bundles, where the `node:` scheme isn't resolvable).
 */
function tokenKey(token: string): string {
  let hash = 5381;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 33) ^ token.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Resolve the GitHub user that owns a PAT via `GET /user` (cached). This is
 * the ONLY trustworthy actor signal the dashboard has — there is no server
 * session, and the client-supplied `actorLogin` is unverified. Audit writes
 * should attribute to this, not to whatever login the browser claimed.
 *
 * Returns null on any failure (bad token, network) — callers fall back to a
 * coarse actor rather than blocking the action being logged.
 */
export async function resolveActorFromToken(
  token: string,
): Promise<ActorIdentity | null> {
  const key = tokenKey(token);
  const hit = actorCache.get(key);
  if (hit && Date.now() - hit.at < ACTOR_TTL_MS) return hit.identity;

  try {
    const octokit = createUserOctokit(token);
    const { data } = await octokit.rest.users.getAuthenticated();
    const identity: ActorIdentity = {
      login: data.login,
      githubId: data.id,
      avatarUrl: data.avatar_url,
    };
    actorCache.set(key, { identity, at: Date.now() });
    return identity;
  } catch (err) {
    logger.warn({ err }, "resolveActorFromToken: GET /user failed");
    return null;
  }
}

// ─── Actor login verification ───────────────────────────────────────────────────

/**
 * Verify that the supplied actorLogin matches the authenticated request.
 *
 * The PAT and its scopes are the authority. Resolve the token owner through
 * GitHub, then reject any caller-supplied actorLogin that does not match.
 */
export async function verifyActorLogin(
  req: NextRequest,
  suppliedLogin: string | undefined,
): Promise<
  | { identity: { login: string; avatar_url: string; githubId: number } }
  | NextResponse
> {
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      {
        error: "request_auth_required",
        message:
          "Actor verification requires x-kody-token, x-kody-owner, and x-kody-repo headers.",
      },
      { status: 401 },
    );
  }

  const resolved = await resolveActorFromToken(headerAuth.token);
  if (!resolved) {
    return NextResponse.json(
      { error: "invalid_token", message: "Unable to verify GitHub identity." },
      { status: 401 },
    );
  }

  if (suppliedLogin && suppliedLogin !== resolved.login) {
    logger.warn(
      {
        suppliedLogin,
        resolvedLogin: resolved.login,
        path: req.nextUrl.pathname,
      },
      "Actor login mismatch",
    );
    return NextResponse.json(
      { error: "actor_mismatch", message: "Actor does not match token owner." },
      { status: 403 },
    );
  }

  return {
    identity: {
      login: resolved.login,
      avatar_url: resolved.avatarUrl,
      githubId: resolved.githubId,
    },
  };
}
