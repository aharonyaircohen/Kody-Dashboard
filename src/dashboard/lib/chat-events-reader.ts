/**
 * @fileType util
 * @domain kody
 * @pattern github-events-reader
 *
 * Shared reader for `events/{sessionId}.jsonl` from the configured Kody
 * state repo via Octokit.
 * Used by both /api/kody/events/poll and /api/kody/events/stream so the
 * caching policy (ETag/304-aware) lives in one place and rate-limit
 * monitoring is consistent.
 *
 * The cache is module-scoped — it survives across requests on a warm
 * Vercel function instance. A 304 response from GitHub is a free hit
 * (does not count against the REST rate limit) and lets us return the
 * previously-decoded lines without re-parsing.
 */

import type { Octokit } from "@octokit/rest";
import { logger } from "./logger";
import { readStateText } from "./state-repo";

interface CachedEvents {
  etag: string;
  lines: string[];
}

const etagCache = new Map<string, CachedEvents>();

export function sessionEventsFilePath(sessionId: string): string {
  return `events/${sessionId}.jsonl`;
}

export interface ReadEventsResult {
  lines: string[];
  exists: boolean;
  /** Whether the response was served from the 304 cache (free read). */
  fromCache: boolean;
}

export async function readEventsFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  _branch: string,
  sessionId: string,
): Promise<ReadEventsResult> {
  const path = sessionEventsFilePath(sessionId);
  const cached = etagCache.get(sessionId);
  try {
    const file = await readStateText(octokit, owner, repo, path, {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const lines = file.content.trim().split("\n").filter(Boolean);
      if (file.etag) etagCache.set(sessionId, { etag: file.etag, lines });
      return { lines, exists: true, fromCache: false };
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    // 304 = file unchanged. Serve cached lines for free.
    if (e.status === 304 && cached)
      return { lines: cached.lines, exists: true, fromCache: true };
    if (e.status !== 404) throw err;
  }
  return { lines: [], exists: false, fromCache: false };
}

/**
 * Drop a session's cache entry. Call when a session ends (chat.exit) so
 * a future re-creation of the same sessionId starts fresh.
 */
export function clearEventsCache(sessionId: string): void {
  etagCache.delete(sessionId);
}
