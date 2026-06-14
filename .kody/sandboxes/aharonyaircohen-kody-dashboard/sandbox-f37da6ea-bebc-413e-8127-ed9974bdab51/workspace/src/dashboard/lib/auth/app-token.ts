/**
 * @fileType utility
 * @domain auth
 * @pattern github-app-installation-token
 * @ai-summary Mint short-lived GitHub App *installation* tokens for a repo,
 *   so unattended background work (webhook fan-out, polling) runs as the App
 *   bot — not a human PAT that GitHub can flag for abuse. Installation tokens
 *   carry their own per-install rate-limit bucket (5000+/hr) that scales with
 *   the org, so background traffic never drains a personal account again.
 *
 *   Self-contained: signs the App JWT with node:crypto (no @octokit/auth-app
 *   dependency). Caches the minted token per repo (~50 min; GitHub tokens last
 *   60 min) and the resolved installation id per owner. Returns null whenever
 *   the App is unconfigured or not installed on the repo, so every caller can
 *   fall back to a vault/PAT token.
 */
import "server-only";
import { createSign } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { logger } from "../logger";

const GITHUB_API = "https://api.github.com";
// Refresh a few minutes before the 60-min GitHub expiry so an in-flight
// request never races the boundary.
const TOKEN_TTL_MS = 50 * 60 * 1000;
const INSTALL_TTL_MS = 60 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const installCache = new Map<string, { id: number; expiresAt: number }>();

/**
 * App ID + PEM private key from env. The key is stored base64-encoded (the
 * shape `pnpm`-pasted into Vercel) OR as a raw PEM with literal `\n`; accept
 * both. Null when either var is missing — the App path is simply disabled.
 */
function getAppCredentials(): { appId: string; privateKey: string } | null {
  const appId = process.env.GITHUB_APP_ID;
  let pk = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !pk) return null;
  if (!pk.includes("BEGIN")) {
    pk = Buffer.from(pk, "base64").toString("utf8");
  }
  pk = pk.replace(/\\n/g, "\n");
  return { appId, privateKey: pk };
}

/** True when both App env vars are present. */
export function isAppConfigured(): boolean {
  return getAppCredentials() !== null;
}

function mintAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  // iat backdated 60s to tolerate clock skew; exp 9 min (<10 min max).
  const payload = b64({ iat: now - 60, exp: now + 540, iss: appId });
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(privateKey)
    .toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function resolveInstallationId(
  owner: string,
  repo: string,
  jwt: string,
): Promise<number | null> {
  const cached = installCache.get(owner.toLowerCase());
  if (cached && cached.expiresAt > Date.now()) return cached.id;

  const res = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "kody-dashboard",
      },
    },
  );
  if (!res.ok) return null; // 404 = App not installed on this repo
  const body = (await res.json()) as { id?: number };
  if (typeof body.id !== "number") return null;
  installCache.set(owner.toLowerCase(), {
    id: body.id,
    expiresAt: Date.now() + INSTALL_TTL_MS,
  });
  return body.id;
}

/**
 * Mint (or return a cached) installation access token for `owner/repo`.
 * Null when the App is unconfigured, not installed, or GitHub errors —
 * callers MUST fall back to another token. Never throws.
 */
export async function getInstallationToken(
  owner: string,
  repo: string,
): Promise<string | null> {
  const key = `${owner}/${repo}`.toLowerCase();
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const creds = getAppCredentials();
  if (!creds) return null;

  try {
    const jwt = mintAppJwt(creds.appId, creds.privateKey);
    const installId = await resolveInstallationId(owner, repo, jwt);
    if (installId === null) return null;

    const res = await fetch(
      `${GITHUB_API}/app/installations/${installId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "kody-dashboard",
        },
      },
    );
    if (!res.ok) {
      logger.warn(
        { event: "app_token_mint_failed", repo: key, status: res.status },
        "GitHub App installation token mint failed",
      );
      return null;
    }
    const body = (await res.json()) as { token?: string };
    if (!body.token) return null;
    tokenCache.set(key, {
      token: body.token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return body.token;
  } catch (err) {
    logger.warn(
      {
        event: "app_token_error",
        repo: key,
        error: err instanceof Error ? err.message : String(err),
      },
      "GitHub App token resolution threw — falling back",
    );
    return null;
  }
}

/** Octokit authed as the App installation, or null when unavailable. */
export async function getInstallationOctokit(
  owner: string,
  repo: string,
): Promise<Octokit | null> {
  const token = await getInstallationToken(owner, repo);
  return token ? new Octokit({ auth: token }) : null;
}
