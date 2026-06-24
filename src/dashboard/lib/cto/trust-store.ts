/**
 * @fileType utility
 * @domain kody
 * @pattern agentResponsibility-trust-file-store
 * @ai-summary Server-only read/CAS-write of the agentResponsibility trust ledger as a single
 *   JSON file in the external state repo (`state/trust.json`) — NOT an
 *   issue. Modeled on `notifications/prefs-store.ts`:
 *     - reads use ETag/If-None-Match (free 304 when unchanged) + a short cache;
 *     - writes use read → mutate → write-with-SHA → retry-on-409 (the file SHA
 *       is real compare-and-swap, unlike the issue-body hack the old ledger used).
 *
 *   One shared file per repo (trust is repo-scoped), so `mutateTrust` does a
 *   read-modify-write loop rather than a blind overwrite to survive concurrent
 *   verdicts from different dashboard instances.
 */
import "server-only";
import { getOwner, getRepo, getOctokit } from "../github-client";
import { readStateText, writeStateText } from "../state-repo";
import {
  EMPTY_TRUST_MANIFEST,
  TRUST_FILE_PATH,
  parseTrustManifest,
  serializeTrustManifest,
  type TrustManifest,
} from "./trust-state";

const CACHE_TTL_MS = 60_000;
const MAX_CAS_RETRIES = 3;

interface CacheEntry {
  data: TrustManifest;
  expires: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry>();

/** Exported for tests — clears all trust cache entries. */
export function _resetTrustCache(): void {
  for (const key of cache.keys()) {
    if (key.startsWith("trust:")) cache.delete(key);
  }
}

function cacheKey(owner: string, repo: string): string {
  return `trust:${owner}:${repo}`;
}

interface ContentResult {
  manifest: TrustManifest;
  sha?: string;
  etag?: string;
}

async function fetchContent(useEtag: boolean): Promise<ContentResult | null> {
  const owner = getOwner();
  const repo = getRepo();
  const key = cacheKey(owner, repo);
  const cached = cache.get(key);
  const octokit = getOctokit();
  try {
    const file = await readStateText(octokit, owner, repo, TRUST_FILE_PATH, {
      headers:
        useEtag && cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const manifest = parseTrustManifest(file.content);
      cache.set(key, {
        data: manifest,
        expires: Date.now() + CACHE_TTL_MS,
        etag: file.etag,
      });
      return { manifest, sha: file.sha, etag: file.etag };
    }
    return { manifest: structuredClone(EMPTY_TRUST_MANIFEST) };
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 304 && cached) {
      cache.set(key, { ...cached, expires: Date.now() + CACHE_TTL_MS });
      return { manifest: cached.data, etag: cached.etag };
    }
    if (status === 404) {
      return { manifest: structuredClone(EMPTY_TRUST_MANIFEST) };
    }
    throw error;
  }
}

/** Cached read of the trust ledger (free 304 when unchanged). */
export async function readTrust(): Promise<TrustManifest> {
  const owner = getOwner();
  const repo = getRepo();
  const key = cacheKey(owner, repo);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  const res = await fetchContent(true);
  return res?.manifest ?? structuredClone(EMPTY_TRUST_MANIFEST);
}

/**
 * Read → apply `mutator` → write, with CAS on the file SHA. Retries on a 409
 * (someone else wrote between our read and write) by re-reading fresh and
 * re-applying the mutator. Returns the committed manifest.
 */
export async function mutateTrust(
  mutator: (current: TrustManifest) => TrustManifest,
): Promise<TrustManifest> {
  const owner = getOwner();
  const repo = getRepo();
  const key = cacheKey(owner, repo);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    // Always read fresh (no ETag) before a write so the SHA is current.
    const current = await fetchContent(false);
    const next = mutator(
      current?.manifest ?? structuredClone(EMPTY_TRUST_MANIFEST),
    );
    const body = serializeTrustManifest(next);
    try {
      const octokit = getOctokit();
      await writeStateText({
        octokit,
        owner,
        repo,
        path: TRUST_FILE_PATH,
        message: "chore(trust): update agentResponsibility trust ledger",
        content: body,
        sha: current?.sha,
      });
      cache.set(key, { data: next, expires: Date.now() + CACHE_TTL_MS });
      return next;
    } catch (error: unknown) {
      lastError = error;
      if ((error as { status?: number })?.status === 409) {
        cache.delete(key);
        continue; // CAS conflict — re-read and retry
      }
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("trust ledger write failed after retries");
}
