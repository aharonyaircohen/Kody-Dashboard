/**
 * @fileType utility
 * @domain kody
 * @pattern auth
 * @ai-summary Mints installation-scoped GitHub tokens from the Kody GitHub App.
 *
 * The dashboard authenticates as a GitHub App rather than a static PAT. Each
 * org/user that installs the App gets its own installation; this module
 * resolves the installation for a given owner/repo and hands back an Octokit
 * authed as that installation. Installation access tokens are short-lived
 * (~1h) — `@octokit/auth-app` mints and refreshes them under the hood, so
 * callers just get a working client.
 *
 * Why per-installation: each installation has its own GitHub rate-limit
 * bucket, so this replaces the single shared-PAT budget that could black out
 * the whole dashboard when drained.
 *
 * Env (all required for the App path; absent → `isGitHubAppConfigured()`
 * returns false and callers fall back to PAT auth):
 *   GITHUB_APP_ID            — numeric App ID
 *   GITHUB_APP_PRIVATE_KEY   — the App's .pem, base64-encoded (one line)
 *   GITHUB_APP_CLIENT_ID     — used by the user-login (OAuth) flow
 *   GITHUB_APP_CLIENT_SECRET — used by the user-login (OAuth) flow
 */
import { createAppAuth } from "@octokit/auth-app";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";

const ThrottledOctokit = Octokit.plugin(throttling);

/**
 * Build an installation/app Octokit with the same throttling behaviour as
 * `createUserOctokit`. Inlined (not a shared object) so TypeScript can
 * contextually type the throttle callbacks.
 */
function makeOctokit(label: string, auth: object): Octokit {
  return new ThrottledOctokit({
    authStrategy: createAppAuth,
    auth,
    throttle: {
      onRateLimit: (retryAfter, options) => {
        if (options.request?.headers?.["x-octokit-retry-count"] === 0) {
          console.warn(`[Kody/${label}] Rate limited, retrying after ${retryAfter}s`);
          return true;
        }
        console.error(`[Kody/${label}] Rate limit hit twice, giving up`);
        return false;
      },
      onSecondaryRateLimit: (retryAfter) => {
        console.warn(`[Kody/${label}] Secondary rate limit, retrying after ${retryAfter}s`);
        return true;
      },
    },
  });
}

// ─── Env resolution (single canonical var each, no fallback chains) ───────────

interface AppCredentials {
  appId: string;
  privateKey: string;
}

/** True when every env var the App path needs is present. */
export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_APP_CLIENT_ID &&
      process.env.GITHUB_APP_CLIENT_SECRET,
  );
}

/**
 * Read + decode the App credentials. The private key is stored base64-encoded
 * so it survives single-line env stores (Vercel, .env). Throws if unset —
 * callers should gate on `isGitHubAppConfigured()` first.
 */
function getAppCredentials(): AppCredentials {
  const appId = process.env.GITHUB_APP_ID;
  const encodedKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !encodedKey) {
    throw new Error("GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY missing)");
  }
  const privateKey = Buffer.from(encodedKey, "base64").toString("utf8");
  return { appId, privateKey };
}

// ─── Installation resolution (cached) ─────────────────────────────────────────

const INSTALLATION_TTL_MS = 6 * 60 * 60 * 1000; // 6h — installations rarely change
const installationCache = new Map<string, { id: number; at: number }>();

/** App-level client (authed by JWT, not an installation) for admin lookups. */
function appOctokit(): Octokit {
  const { appId, privateKey } = getAppCredentials();
  return makeOctokit("App", { appId, privateKey });
}

/**
 * Resolve the installation ID for a repo (cached). Returns null when the App
 * isn't installed on that owner/repo — callers fall back to PAT auth rather
 * than failing the request.
 */
export async function getInstallationId(owner: string, repo: string): Promise<number | null> {
  const key = `${owner}/${repo}`;
  const hit = installationCache.get(key);
  if (hit && Date.now() - hit.at < INSTALLATION_TTL_MS) return hit.id;

  try {
    const { data } = await appOctokit().rest.apps.getRepoInstallation({ owner, repo });
    installationCache.set(key, { id: data.id, at: Date.now() });
    return data.id;
  } catch {
    return null;
  }
}

// ─── Installation-scoped Octokit ──────────────────────────────────────────────

/**
 * Get an Octokit authed as the App's installation on `owner/repo`, acting as
 * `kody[bot]`. The installation access token is minted and auto-refreshed by
 * `@octokit/auth-app`. Returns null when the App is unconfigured or not
 * installed on the repo — callers fall back to PAT auth.
 */
export async function getInstallationOctokit(owner: string, repo: string): Promise<Octokit | null> {
  if (!isGitHubAppConfigured()) return null;

  const installationId = await getInstallationId(owner, repo);
  if (installationId === null) return null;

  const { appId, privateKey } = getAppCredentials();
  return makeOctokit("Installation", { appId, privateKey, installationId });
}
