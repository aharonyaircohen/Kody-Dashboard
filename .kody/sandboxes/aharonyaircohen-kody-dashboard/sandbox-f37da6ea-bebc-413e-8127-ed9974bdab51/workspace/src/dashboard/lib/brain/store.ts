/**
 * @fileType utility
 * @domain kody
 * @pattern brain-app-file-store
 * @ai-summary Per-user record of the Brain Fly app the dashboard provisioned.
 *   One JSON file per GitHub login at
 *   `.kody/users/<login>/data/brain.json` on the `kody-state` branch.
 *
 *   Mirrors `notifications/prefs-store.ts`: ETag/If-None-Match for free 304s,
 *   CAS writes (fetch SHA → write with SHA → retry once on 409). The folder
 *   shape (`users/<login>/data/…`) is intentionally a folder per user so
 *   future per-user data files (`preferences.json`, `settings.json`, …) can
 *   sit alongside `brain.json` without colliding.
 *
 *   This file is the source of truth for the Runner page: it surfaces
 *   "here is the Fly app we believe you have, and the org we put it in" so
 *   the user can terminate it from the UI even if the Fly token can no
 *   longer see the app (the orphan case — token revoked, app moved to a
 *   different org, etc.).
 */
import "server-only";

import { STATE_BRANCH } from "../state-branch";
import { getOctokit, getOwner, getRepo } from "../github-client";

/** TTL for brain app cache. Low-churn data — 5 min matches the prefs store. */
const BRAIN_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expires: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Exported for unit tests — clears all brain-store cache entries. */
export function _resetBrainAppCache(): void {
  for (const key of cache.keys()) {
    if (key.startsWith("brain-app:")) {
      cache.delete(key);
    }
  }
}

function getCache<T>(key: string): { data: T; etag?: string } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data, etag: entry.etag };
}

function setCache<T>(key: string, data: T, etag?: string): void {
  cache.set(key, { data, expires: Date.now() + BRAIN_CACHE_TTL_MS, etag });
}

function cacheKey(owner: string, repo: string, login: string): string {
  return `brain-app:${owner}:${repo}:${login.toLowerCase()}`;
}

function filePath(login: string): string {
  return `.kody/users/${login.toLowerCase()}/data/brain.json`;
}

/** Persisted Brain app record. Versioned for future migrations. */
export interface BrainAppFile {
  version: 1;
  appName: string;
  orgSlug: string;
  createdAt: string;
}

function isBrainAppFile(value: unknown): value is BrainAppFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.appName === "string" &&
    v.appName.length > 0 &&
    typeof v.orgSlug === "string" &&
    typeof v.createdAt === "string"
  );
}

/**
 * Read the Brain app record for a user from the kody-state branch.
 * Returns `null` when no record exists (user has never provisioned, or the
 * file was deleted). Throws on non-404 GitHub errors so the caller can
 * surface a real failure.
 */
export async function readBrainApp(
  login: string,
  token: string,
): Promise<BrainAppFile | null> {
  const owner = getOwner();
  const repo = getRepo();
  const path = filePath(login);
  const key = cacheKey(owner, repo, login);

  const cached = getCache<BrainAppFile | null>(key);
  const octokit = getOctokit();

  try {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: STATE_BRANCH,
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    const etag = (res.headers as Record<string, string | undefined>)?.etag;
    if (!Array.isArray(res.data) && "content" in res.data && res.data.content) {
      const raw = Buffer.from(res.data.content, "base64").toString("utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!isBrainAppFile(parsed)) {
        // Corrupt file — treat as missing so the caller can recover.
        setCache(key, null, etag);
        return null;
      }
      setCache(key, parsed, etag);
      return parsed;
    }
    setCache(key, null, etag);
    return null;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 304 && cached) {
      setCache(key, cached.data, cached.etag);
      return cached.data;
    }
    if (status === 404) {
      setCache(key, null);
      return null;
    }
    throw error;
  }
}

/**
 * Write the Brain app record for a user to the kody-state branch. Uses CAS:
 * fetches the current SHA, then writes with it. Retries once on 409.
 */
export async function writeBrainApp(
  login: string,
  token: string,
  file: BrainAppFile,
): Promise<void> {
  const owner = getOwner();
  const repo = getRepo();
  const path = filePath(login);
  const key = cacheKey(owner, repo, login);

  cache.delete(key);

  let sha: string | undefined;

  try {
    const octokit = getOctokit();
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: STATE_BRANCH,
    });
    if (!Array.isArray(res.data) && "sha" in res.data) {
      sha = res.data.sha;
    }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status !== 404) throw error;
  }

  const content = JSON.stringify(file, null, 2);
  const message = `feat(brain): record brain app for ${login}`;

  try {
    const octokit = getOctokit();
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha,
      branch: STATE_BRANCH,
    });
    return;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 409) {
      try {
        const octokit = getOctokit();
        const res = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: STATE_BRANCH,
        });
        const freshSha =
          !Array.isArray(res.data) && "sha" in res.data
            ? res.data.sha
            : undefined;
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message,
          content: Buffer.from(content, "utf-8").toString("base64"),
          sha: freshSha,
          branch: STATE_BRANCH,
        });
        return;
      } catch {
        // fall through to throw
      }
    }
    throw error;
  }
}

/**
 * Delete the Brain app record for a user from the kody-state branch.
 * Idempotent — returns silently if the file doesn't exist. Best-effort:
 * the Brain record is metadata; if clearing fails the caller can still
 * proceed (the next write will overwrite).
 */
export async function clearBrainApp(
  login: string,
  token: string,
): Promise<void> {
  const owner = getOwner();
  const repo = getRepo();
  const path = filePath(login);
  const key = cacheKey(owner, repo, login);

  cache.delete(key);

  try {
    const octokit = getOctokit();
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: STATE_BRANCH,
    });
    if (Array.isArray(res.data) || !("sha" in res.data)) return;
    await octokit.repos.deleteFile({
      owner,
      repo,
      path,
      message: `feat(brain): clear brain app for ${login}`,
      sha: res.data.sha,
      branch: STATE_BRANCH,
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 404) return;
    throw error;
  }
}
