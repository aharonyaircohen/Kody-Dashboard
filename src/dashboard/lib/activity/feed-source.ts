/**
 * @fileType utility
 * @domain kody
 * @pattern activity-feed-source
 * @ai-summary Rate-limit-safe reader for the engine event log behind the
 *   Activity Feed tab. `getAllEvents` does an *uncached* full-file GitHub
 *   fetch, and the Feed must not regress the shared polling budget
 *   (CLAUDE.md rate-limit rules). So this wraps it with the same shape as
 *   `fetchOpenPRs`: a 60s in-process cache, in-flight dedup, and a stale
 *   fallback that refreshes the TTL on error so a throttled GitHub doesn't
 *   compound. The Feed tab is also load-on-demand (not polled), so steady
 *   state costs zero GitHub calls.
 */
import { createUserOctokit } from "../github-client";
import { getAllEvents, type EventLogEntry } from "../kody-store/event-log";

const TTL_MS = 60_000;

interface Entry {
  data: EventLogEntry[];
  expires: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<EventLogEntry[]>>();

/**
 * Read the connected repo's `.kody/event-log.jsonl`, cached for 60s with
 * in-flight dedup and a stale fallback. `owner`/`repo`/`token` come from the
 * request auth so the Feed reflects the repo the user is connected to.
 */
export async function readEventLogCached(
  owner: string,
  repo: string,
  token: string,
): Promise<EventLogEntry[]> {
  const key = `${owner}/${repo}`;

  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const octokit = createUserOctokit(token);
      const events = await getAllEvents({ owner, repo, octokit });
      cache.set(key, { data: events, expires: Date.now() + TTL_MS });
      return events;
    } catch (err) {
      // Throttled / errored: serve the last good list and refresh the TTL so
      // we don't hammer GitHub on every subsequent open while degraded.
      if (cached) {
        cache.set(key, { data: cached.data, expires: Date.now() + TTL_MS });
        return cached.data;
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
