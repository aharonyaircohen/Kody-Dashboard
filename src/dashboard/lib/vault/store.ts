/**
 * @fileType utility
 * @domain vault
 * @pattern github-contents
 * @ai-summary Read/write a per-repo encrypted vault file at .kody/secrets.enc
 *   in the connected GitHub repo. Uses the GitHub Contents API. Caches
 *   decrypted contents per repo with a 60s TTL + in-flight dedup so polling
 *   doesn't stampede GitHub. Cache is invalidated on writes from the same
 *   instance; other instances pick up changes within TTL.
 */

import type { Octokit } from "@octokit/rest";
import { decrypt, encrypt } from "./crypto";
import { logger } from "@dashboard/lib/logger";

export const VAULT_PATH = ".kody/secrets.enc";

export interface VaultSecretMeta {
  /** ISO timestamp of the last update. */
  updatedAt: string;
  /** GitHub login of the last writer. */
  updatedBy?: string;
}

export interface VaultEntry extends VaultSecretMeta {
  value: string;
}

export interface VaultDocument {
  version: 1;
  secrets: Record<string, VaultEntry>;
}

interface CacheEntry {
  doc: VaultDocument;
  sha: string | null;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<
  string,
  Promise<{ doc: VaultDocument; sha: string | null }>
>();
const TTL_MS = 60_000;

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function emptyDoc(): VaultDocument {
  return { version: 1, secrets: {} };
}

interface RawContentsResponse {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
}

async function fetchRaw(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ doc: VaultDocument; sha: string | null }> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: VAULT_PATH,
      // Add a no-cache header to avoid stale CDN responses on writes.
      headers: { "If-None-Match": "" },
    });
    const data = res.data as RawContentsResponse | RawContentsResponse[];
    if (Array.isArray(data) || data.type !== "file" || !data.content) {
      // An empty-but-existing file (e.g. after a vault reset) still has a sha
      // that GitHub requires to overwrite it. Preserve it so the next write
      // doesn't get rejected with "sha wasn't supplied".
      const sha =
        !Array.isArray(data) && data.type === "file" ? (data.sha ?? null) : null;
      return { doc: emptyDoc(), sha };
    }
    const buf = Buffer.from(
      data.content,
      (data.encoding ?? "base64") as BufferEncoding,
    );
    const ciphertext = buf.toString("utf8").trim();
    const plaintext = decrypt(ciphertext);
    const parsed = JSON.parse(plaintext) as VaultDocument;
    if (parsed.version !== 1 || typeof parsed.secrets !== "object") {
      throw new Error("Vault document has unexpected shape");
    }
    return { doc: parsed, sha: data.sha ?? null };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return { doc: emptyDoc(), sha: null };
    }
    throw err;
  }
}

export async function readVault(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<{ doc: VaultDocument; sha: string | null }> {
  const key = cacheKey(owner, repo);
  if (!options.force) {
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { doc: cached.doc, sha: cached.sha };
    }
  }

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const promise = fetchRaw(octokit, owner, repo)
    .then((result) => {
      CACHE.set(key, {
        doc: result.doc,
        sha: result.sha,
        expiresAt: Date.now() + TTL_MS,
      });
      return result;
    })
    .finally(() => {
      INFLIGHT.delete(key);
    });

  INFLIGHT.set(key, promise);
  return promise;
}

export async function writeVault(
  octokit: Octokit,
  owner: string,
  repo: string,
  doc: VaultDocument,
  currentSha: string | null,
  commitMessage = "chore(vault): update dashboard secrets",
): Promise<{ sha: string }> {
  const ciphertext = encrypt(JSON.stringify(doc));
  const content = Buffer.from(ciphertext, "utf8").toString("base64");
  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: VAULT_PATH,
    message: commitMessage,
    content,
    ...(currentSha ? { sha: currentSha } : {}),
  });
  const newSha = res.data.content?.sha ?? null;
  CACHE.set(cacheKey(owner, repo), {
    doc,
    sha: newSha,
    expiresAt: Date.now() + TTL_MS,
  });
  if (!newSha) {
    logger.warn({ owner, repo }, "vault: GitHub returned no sha after write");
    return { sha: "" };
  }
  return { sha: newSha };
}

export function invalidateVaultCache(owner: string, repo: string): void {
  CACHE.delete(cacheKey(owner, repo));
}

/** Strip secret values for safe API responses. */
export function listSecretMetadata(
  doc: VaultDocument,
): Array<{ name: string; updatedAt: string; updatedBy?: string }> {
  return Object.entries(doc.secrets)
    .map(([name, entry]) => ({
      name,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
