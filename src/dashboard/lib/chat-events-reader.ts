/**
 * @fileType util
 * @domain kody
 * @pattern github-events-reader
 *
 * Shared reader for `.kody/events/{sessionId}.jsonl` from GitHub via Octokit.
 * Used by both /api/kody/events/poll and /api/kody/events/stream so the
 * caching policy (ETag/304-aware) lives in one place and rate-limit
 * monitoring is consistent.
 *
 * The cache is module-scoped — it survives across requests on a warm
 * Vercel function instance. A 304 response from GitHub is a free hit
 * (does not count against the REST rate limit) and lets us return the
 * previously-decoded lines without re-parsing.
 */

import { Buffer } from "buffer";
import type { Octokit } from "@octokit/rest";
import { logger } from "./logger";

interface CachedEvents {
  etag: string;
  lines: string[];
}

const etagCache = new Map<string, CachedEvents>();

export function sessionEventsFilePath(sessionId: string): string {
  return `.kody/events/${sessionId}.jsonl`;
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
  branch: string,
  sessionId: string,
): Promise<ReadEventsResult> {
  const path = sessionEventsFilePath(sessionId);
  const cached = etagCache.get(sessionId);
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    const { data, headers } = response;
    const h = headers as Record<string, string> | undefined;
    const newEtag = h?.etag;
    const remaining = h?.["x-ratelimit-remaining"];
    if (remaining !== undefined && Number(remaining) < 500) {
      logger.warn(
        { remaining, sessionId, resource: h?.["x-ratelimit-resource"] },
        "github rate-limit low",
      );
    }
    if ("content" in data && data.content) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (newEtag) etagCache.set(sessionId, { etag: newEtag, lines });
      return { lines, exists: true, fromCache: false };
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    // 304 = file unchanged. Serve cached lines for free.
    if (e.status === 304 && cached) return { lines: cached.lines, exists: true, fromCache: true };
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
