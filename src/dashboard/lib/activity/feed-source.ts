/**
 * @fileType utility
 * @domain kody
 * @pattern activity-feed-source
 * @ai-summary Rate-limit-safe reader for the Activity Feed. The engine
 *   streams events to per-session files `.kody/events/{sessionId}.jsonl`
 *   in the connected repo (NOT the dashboard-internal
 *   `.kody/event-log.jsonl`, which the engine doesn't write here). So the
 *   Feed lists the events dir, takes the most-recent N sessions, and reads
 *   each via the shared ETag-aware `readEventsFile`. The directory listing
 *   has its own 60s cache + in-flight dedup + stale fallback (CLAUDE.md
 *   rate-limit rules); per-file reads get free 304s from `readEventsFile`.
 *   The Feed tab is also load-on-demand (not polled), so steady state is
 *   ~zero GitHub calls.
 */
import type { Octokit } from "@octokit/rest";
import { createUserOctokit } from "../github-client";
import { readEventsFile } from "../chat-events-reader";
import type { EventLogEntry } from "../kody-store/event-log";

const BRANCH = process.env.KODY_STORE_BRANCH ?? "main";
const EVENTS_DIR = ".kody/events";
const LIST_TTL_MS = 60_000;
/** Most-recent session files merged into one feed — caps GitHub reads. */
const MAX_SESSIONS = 12;

interface ListEntry {
  data: string[];
  expires: number;
}
const listCache = new Map<string, ListEntry>();
const listInflight = new Map<string, Promise<string[]>>();

/**
 * Session filenames embed an epoch (`live-1778149397247-xxx`,
 * `live-direct-1778080135`). Sort by the largest numeric token so newest
 * sessions win without a per-file mtime lookup.
 */
function sessionTs(name: string): number {
  let max = 0;
  for (const n of name.match(/\d+/g) ?? []) {
    const v = Number(n);
    if (v > max) max = v;
  }
  return max;
}

async function listRecentSessions(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string[]> {
  const key = `${owner}/${repo}`;
  const cached = listCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  const existing = listInflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: EVENTS_DIR,
        ref: BRANCH,
      });
      const files = Array.isArray(data) ? data : [];
      const sessions = files
        .filter((f) => f.type === "file" && f.name.endsWith(".jsonl"))
        .sort((a, b) => sessionTs(b.name) - sessionTs(a.name))
        .slice(0, MAX_SESSIONS)
        .map((f) => f.name.replace(/\.jsonl$/, ""));
      listCache.set(key, { data: sessions, expires: Date.now() + LIST_TTL_MS });
      return sessions;
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (cached) {
        // Throttled/errored: serve last good list, refresh TTL so we don't
        // hammer GitHub on every subsequent open while degraded.
        listCache.set(key, {
          data: cached.data,
          expires: Date.now() + LIST_TTL_MS,
        });
        return cached.data;
      }
      if (e.status === 404) return []; // repo has no events dir yet
      throw err;
    } finally {
      listInflight.delete(key);
    }
  })();

  listInflight.set(key, promise);
  return promise;
}

interface RawLine {
  event?: string;
  payload?: Record<string, unknown>;
  runId?: string;
  emittedAt?: string;
  channel?: string;
  actionState?: EventLogEntry["actionState"];
}

/**
 * Read the connected repo's recent session event files and flatten them
 * into `EventLogEntry`-shaped records for the pure feed fold.
 */
export async function readFeedEntries(
  owner: string,
  repo: string,
  token: string,
): Promise<EventLogEntry[]> {
  const octokit = createUserOctokit(token);
  const sessions = await listRecentSessions(octokit, owner, repo);

  const entries: EventLogEntry[] = [];
  await Promise.all(
    sessions.map(async (sid) => {
      let res;
      try {
        res = await readEventsFile(octokit, owner, repo, BRANCH, sid);
      } catch {
        return; // one bad session file shouldn't sink the whole feed
      }
      res.lines.forEach((line, idx) => {
        let o: RawLine;
        try {
          o = JSON.parse(line) as RawLine;
        } catch {
          return; // skip malformed line
        }
        if (!o.event) return;
        entries.push({
          id: `${sid}:${idx}`,
          runId: o.runId ?? "unknown",
          event: o.event,
          payload: o.payload ?? {},
          channel: o.channel,
          actionState: o.actionState,
          emittedAt: o.emittedAt ?? new Date().toISOString(),
        });
      });
    }),
  );
  return entries;
}
