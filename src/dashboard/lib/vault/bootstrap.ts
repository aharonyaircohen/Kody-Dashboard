/**
 * @fileType utility
 * @domain vault
 * @pattern public-vault-bootstrap
 * @ai-summary Resolve a repo's GitHub token from its vault WITHOUT already
 *   holding a token — the bootstrap case for unauthenticated server flows
 *   (the GitHub webhook receiver). Works only for PUBLIC repos: the encrypted
 *   `.kody/secrets.enc` blob is world-readable, so we fetch it unauthenticated,
 *   then decrypt with `KODY_MASTER_KEY` (the only secret Vercel holds). This is
 *   how the webhook gets a token to write the inbox-feed/push manifests under
 *   the "Vercel stores only KODY_MASTER_KEY" rule.
 *
 *   Cached per-repo (10 min) so the unauthenticated 60-req/hr/IP limit is never
 *   the bottleneck — one vault read per repo per window, not per webhook.
 *   Returns null on any failure (private repo / 404 / missing secret / bad
 *   key) so callers fail soft exactly as before.
 */
import { decrypt, isVaultConfigured } from "./crypto";
import { VAULT_PATH } from "./store";

const GITHUB_API = "https://api.github.com";
const CACHE_TTL_MS = 10 * 60 * 1000;

interface VaultDoc {
  secrets?: Record<string, { value?: unknown }>;
}

const cache = new Map<string, { token: string | null; expiresAt: number }>();

/**
 * Read `secretName` (default `GITHUB_TOKEN`) from a public repo's vault using
 * only `KODY_MASTER_KEY`. Null if the repo isn't public, the vault/secret is
 * absent, or the master key is unset/wrong. Never throws.
 */
export async function resolveVaultGithubToken(
  owner: string,
  repo: string,
  secretName = "GITHUB_TOKEN",
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const key = `${owner}/${repo}/${secretName}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const token = await readOnce(owner, repo, secretName, fetchImpl);
  cache.set(key, { token, expiresAt: Date.now() + CACHE_TTL_MS });
  return token;
}

async function readOnce(
  owner: string,
  repo: string,
  secretName: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  if (!isVaultConfigured()) return null;
  try {
    // Unauthenticated Contents API read — only succeeds for public repos.
    const res = await fetchImpl(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${VAULT_PATH}`,
      { headers: { Accept: "application/vnd.github+json", "User-Agent": "kody-dashboard" } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: string; encoding?: string };
    if (!body.content) return null;
    const payload = Buffer.from(body.content, (body.encoding ?? "base64") as BufferEncoding)
      .toString("utf8")
      .trim();
    const doc = JSON.parse(decrypt(payload)) as VaultDoc;
    const value = doc.secrets?.[secretName]?.value;
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}
