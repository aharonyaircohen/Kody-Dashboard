/**
 * @fileType utility
 * @domain kody
 * @pattern notification-prefs-file-store
 * @ai-summary Read/write per-user notification preferences as a JSON file on the
 *   configured Kody state repo (`notifications/preferences/<login>.json`). One
 *   file per user → no cross-user write contention. Reads use ETag/If-None-Match
 *   so unchanged reads are a free 304. Writes use CAS (fetch SHA → write with
 *   SHA → retry on conflict).
 *
 *   This is the reusable state-repo JSON file-store helper. It generalizes to
 *   any key → `<dir>/<key>.json` path, with the state repo ref and ETag caching
 *   built in.
 */
import "server-only";
import { getOwner, getRepo, getOctokit } from "../github-client";
import { readStateText, writeStateText } from "../state-repo";

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

/** The directory within the Kody state repo where per-user prefs live. */
export const PREFS_DIR = "notifications/preferences";

function filePath(login: string): string {
  return `${PREFS_DIR}/${login.toLowerCase()}.json`;
}

/**
 * Read notification preferences for a user from the configured Kody state repo.
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
    const file = await readStateText(octokit, owner, repo, path, {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const parsed = JSON.parse(file.content) as NotificationPrefsFile;
      const prefs: NotificationPrefsFile = {
        version: parsed.version === 1 ? 1 : 1,
        mutedTypes: Array.isArray(parsed.mutedTypes) ? parsed.mutedTypes : [],
      };
      setCache(key, prefs, file.etag);
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
 * Write notification preferences for a user to the configured Kody state repo.
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
  // Attempt to read existing SHA (ignore errors — file may not exist yet)
  try {
    const octokit = getOctokit();
    const file = await readStateText(octokit, owner, repo, path);
    sha = file?.sha;
  } catch {
    // File may not exist yet or preferences may be temporarily unavailable.
  }

  const content = JSON.stringify(prefs, null, 2);
  const message = `feat(notifications): update prefs for ${login}`;

  try {
    const octokit = getOctokit();
    await writeStateText({
      octokit,
      owner,
      repo,
      path,
      message,
      content,
      sha,
    });
    return;
  } catch (error: unknown) {
    // CAS conflict — retry once with fresh SHA
    if ((error as { status?: number })?.status === 409) {
      try {
        const octokit = getOctokit();
        const file = await readStateText(octokit, owner, repo, path);
        await writeStateText({
          octokit,
          owner,
          repo,
          path,
          message,
          content,
          sha: file?.sha,
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
