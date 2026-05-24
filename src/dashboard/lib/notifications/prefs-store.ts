/**
 * @fileType utility
 * @domain kody
 * @pattern notification-prefs-file-store
 * @ai-summary Read/write per-user notification preferences as a JSON file on the
 *   `kody-state` branch (`.kody/notifications/preferences/<login>.json`). One
 *   file per user → no cross-user write contention. Reads use ETag/If-None-Match
 *   so unchanged reads are a free 304. Writes use CAS (fetch SHA → write with
 *   SHA → retry on conflict).
 *
 *   This is the reusable `.kody/` JSON file-store helper the issue requests.
 *   It generalizes to any key → `.kody/<dir>/<key>.json` path, with the state
 *   branch ref and ETag caching built in.
 */
import "server-only";
import { STATE_BRANCH } from "../state-branch";
import { getOwner, getRepo, getOctokit } from "../github-client";

/** TTL for notification prefs cache. Low-churn data — 5 min is fine. */
const PREFS_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expires: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Exported for unit tests — clears all prefs cache entries. */
export function _resetPrefsCache(): void {
  for (const key of cache.keys()) {
    if (key.startsWith("notif-prefs:")) {
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
  cache.set(key, { data, expires: Date.now() + PREFS_CACHE_TTL_MS, etag });
}

function cacheKey(owner: string, repo: string, login: string): string {
  return `notif-prefs:${owner}:${repo}:${login.toLowerCase()}`;
}

/**
 * Server-known notification types that can be individually muted.
 * Subset of NotificationType that can be enforced server-side (i.e., those
 * produced by the mention/inbox webhook spine).
 */
export type ServerNotificationType =
  | "task-assigned"
  | "task-completed"
  | "task-failed"
  | "pr-ready"
  | "pr-merged"
  | "chat-response"
  | "gate-waiting";

/** Persisted notification preferences shape. */
export interface NotificationPrefsFile {
  version: 1;
  mutedTypes: ServerNotificationType[];
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsFile = {
  version: 1,
  mutedTypes: [],
};

/** The directory within `.kody/` where per-user prefs live. */
export const PREFS_DIR = ".kody/notifications/preferences";

function filePath(login: string): string {
  return `${PREFS_DIR}/${login.toLowerCase()}.json`;
}

/**
 * Read notification preferences for a user from the kody-state branch.
 * Returns the cached data if still valid, otherwise fetches from GitHub
 * (using If-None-Match for a free 304 when unchanged).
 */
export async function readNotificationPrefs(
  login: string,
  token: string,
): Promise<NotificationPrefsFile> {
  const owner = getOwner();
  const repo = getRepo();
  const path = filePath(login);
  const key = cacheKey(owner, repo, login);

  const cached = getCache<NotificationPrefsFile>(key);
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
      const parsed = JSON.parse(raw) as NotificationPrefsFile;
      const prefs: NotificationPrefsFile = {
        version: parsed.version === 1 ? 1 : 1,
        mutedTypes: Array.isArray(parsed.mutedTypes) ? parsed.mutedTypes : [],
      };
      setCache(key, prefs, etag);
      return prefs;
    }
    return DEFAULT_NOTIFICATION_PREFS;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 304 && cached) {
      // Content unchanged; refresh TTL
      setCache(key, cached.data, cached.etag);
      return cached.data;
    }
    if (status === 404) {
      setCache(key, DEFAULT_NOTIFICATION_PREFS);
      return DEFAULT_NOTIFICATION_PREFS;
    }
    // On any other error (network, rate limit, etc.), fail open with defaults.
    return cached?.data ?? DEFAULT_NOTIFICATION_PREFS;
  }
}

/**
 * Write notification preferences for a user to the kody-state branch.
 * Uses CAS: fetches the current SHA, then writes with it. Retries once on
 * conflict (GitHub returns 409 when SHA doesn't match).
 */
export async function writeNotificationPrefs(
  login: string,
  token: string,
  prefs: NotificationPrefsFile,
): Promise<void> {
  const owner = getOwner();
  const repo = getRepo();
  const path = filePath(login);
  const key = cacheKey(owner, repo, login);

  // Invalidate cache so the next read goes to GitHub
  cache.delete(key);

  let sha: string | undefined;
  let status: number | undefined;

  // Attempt to read existing SHA (ignore errors — file may not exist yet)
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
    status = (error as { status?: number })?.status;
  }

  const content = JSON.stringify(prefs, null, 2);
  const message = `feat(notifications): update prefs for ${login}`;

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
    // CAS conflict — retry once with fresh SHA
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
        // Give up — preferences are best-effort
      }
    }
    // Give up — preferences are best-effort; throw so caller knows
    throw error;
  }
}
