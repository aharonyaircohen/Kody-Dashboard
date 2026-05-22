/**
 * @fileType utility
 * @domain kody
 * @pattern auth
 * @ai-summary Per-request auth for the Kody Operations Dashboard.
 *
 * Auth priority:
 * 1. Request headers from client (x-kody-token, x-kody-owner, x-kody-repo)
 * 2. Env vars (KODY_BOT_TOKEN, GITHUB_TOKEN, GH_PAT) — server-side fallback
 *    used by cron jobs / webhook handlers that have no logged-in user.
 *
 * There is no server-side session: the dashboard stores credentials in
 * localStorage after the user connects a repo, and every API call passes
 * them via the three custom headers above.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createUserOctokit,
  getOwner,
  getRepo,
} from "@dashboard/lib/github-client";
import { getInstallationOctokit } from "@dashboard/lib/auth/github-app";
import { logger } from "@dashboard/lib/logger";
import type { Octokit } from "@octokit/rest";

// ─── Header constants (must match auth-context.ts buildAuthHeaders) ─────────────

const HDR_TOKEN = "x-kody-token";
const HDR_OWNER = "x-kody-owner";
const HDR_REPO = "x-kody-repo";

// ─── Per-request auth from headers ────────────────────────────────────────────

export interface RequestAuth {
  token: string;
  owner: string;
  repo: string;
}

/**
 * Extract auth from request headers (set by client from localStorage).
 * Returns null if headers are missing or incomplete.
 */
export function getRequestAuth(req: NextRequest): RequestAuth | null {
  const token = req.headers.get(HDR_TOKEN);
  const owner = req.headers.get(HDR_OWNER);
  const repo = req.headers.get(HDR_REPO);

  if (!token || !owner || !repo) return null;
  return { token, owner, repo };
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

// ─── Require auth — 401 if neither header token nor env token present ─────────

/**
 * Require auth for a route. Checks:
 * 1. x-kody-token header (client localStorage auth)
 * 2. KODY_BOT_TOKEN / GITHUB_TOKEN env var (server-side fallback)
 *
 * Returns null on success, or a NextResponse on failure.
 */
export async function requireKodyAuth(
  req: NextRequest,
): Promise<null | NextResponse> {
  const headerAuth = getRequestAuth(req);
  const envToken = getEnvToken();

  if (!headerAuth && !envToken) {
    return NextResponse.json(
      {
        message:
          "Not authenticated. Provide x-kody-token header or set KODY_BOT_TOKEN env var.",
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
 * 1. Client token from x-kody-token header (localStorage auth) — keeps writes
 *    attributed to the actual user.
 * 2. GitHub App installation token for the connected repo (acts as kody[bot],
 *    its own rate-limit bucket) — replaces the shared env PAT for server-side
 *    calls (cron / webhooks) that have no logged-in user.
 * 3. Env token fallback (App unconfigured / not installed on the repo).
 */
export async function getUserOctokit(
  req: NextRequest,
): Promise<Octokit | null> {
  // 1. Client header token (localStorage auth)
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    return createUserOctokit(headerAuth.token);
  }

  // 2. GitHub App installation token for the request's repo, when known.
  const owner = safe(getOwner);
  const repo = safe(getRepo);
  if (owner && repo) {
    const appOctokit = await getInstallationOctokit(owner, repo);
    if (appOctokit) return appOctokit;
  }

  // 3. Env token fallback
  const envToken = getEnvToken();
  if (envToken) {
    return createUserOctokit(envToken);
  }

  return null;
}

/** Read repo context without throwing if it isn't set on this request. */
function safe(fn: () => string): string | null {
  try {
    return fn() || null;
  } catch {
    return null;
  }
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
    const { data } = await octokit.users.getAuthenticated();
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
 * Without a server-side session there is no canonical "logged-in user" to
 * compare against — the PAT and its scopes are the only authority. This
 * function now just accepts any actorLogin string as long as auth is
 * present, returning a stub identity. Callers that need real attribution
 * should resolve `actorLogin` to the GitHub user themselves.
 */
export async function verifyActorLogin(
  req: NextRequest,
  suppliedLogin: string | undefined,
): Promise<
  | { identity: { login: string; avatar_url: string; githubId: number } }
  | NextResponse
> {
  const authError = await requireKodyAuth(req);
  if (authError !== null) {
    return authError;
  }

  logger.info(
    { actorLogin: suppliedLogin, path: req.nextUrl.pathname },
    "Token auth: actorLogin verification skipped (no server session)",
  );
  return {
    identity: {
      login: suppliedLogin || "token-user",
      avatar_url:
        "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
      githubId: 0,
    },
  };
}
