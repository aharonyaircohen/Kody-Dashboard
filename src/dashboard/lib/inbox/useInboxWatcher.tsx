"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern inbox-watcher
 * @ai-summary Polls the server-side inbox **feed** every 60s and syncs new
 *   entries down into the user's private inbox gist. Mount once at the app
 *   root.
 *
 *   Why the feed, not GitHub /notifications: the feed is written by the
 *   webhook receiver the instant anyone `@mentions` you — using the exact
 *   same body-scrape as web-push. The old watcher polled GitHub's
 *   /notifications and trusted its `reason` classification, which silently
 *   dropped every mention GitHub filed as subscribed/comment/author, every
 *   commit-comment mention, and everything that arrived while no tab was
 *   open. Push delivered those; the inbox didn't. One detector now feeds
 *   both, so the inbox matches push exactly.
 *
 *   Rate budget: the feed manifest is read on the dashboard's cached GitHub
 *   path (TTL + ETag), so a 60s poll costs at most one cheap revalidation —
 *   and removes the old per-tick /notifications call plus per-thread detail
 *   fetches. Net reduction. See CLAUDE.md > "GitHub API rate-limit rules".
 */
import { useEffect, useRef } from "react";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { useInboxAppend } from "./useInbox";
import type { InboxEntry } from "./types";

const POLL_INTERVAL_MS = 60_000;
const CURSOR_KEY = (owner: string, repo: string) =>
  `kody.inbox.feedCursor.${owner}/${repo}`;

interface FeedEntry {
  id: string;
  login: string;
  source: InboxEntry["source"];
  repoFullName: string;
  threadType: string;
  title: string;
  snippet: string;
  author?: string;
  url: string;
  sentAt: string;
  ctoAction?: string;
  ctoCommand?: string;
}

function readCursor(owner: string, repo: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CURSOR_KEY(owner, repo));
  } catch {
    return null;
  }
}

function writeCursor(owner: string, repo: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CURSOR_KEY(owner, repo), value);
  } catch {
    // localStorage full / unavailable — next poll re-fetches from old cursor.
  }
}

async function runOnce(opts: {
  owner: string;
  repo: string;
  headers: Record<string, string>;
  appendEntries: (entries: InboxEntry[]) => Promise<void>;
}): Promise<void> {
  const { owner, repo, headers, appendEntries } = opts;
  const cursor = readCursor(owner, repo);
  const qs = cursor ? `?since=${encodeURIComponent(cursor)}` : "";

  let res: Response;
  try {
    res = await fetch(`/api/kody/inbox/feed${qs}`, { headers });
  } catch {
    return; // network hiccup — retry next tick
  }
  if (!res.ok) return;

  const data = (await res.json().catch(() => null)) as {
    entries?: FeedEntry[];
  } | null;
  const list = Array.isArray(data?.entries) ? data!.entries : [];
  if (list.length === 0) return;

  const fresh: InboxEntry[] = list.map((f) => ({
    id: f.id,
    source: f.source,
    repoFullName: f.repoFullName,
    threadType: f.threadType,
    title: f.title,
    snippet: f.snippet,
    author: f.author,
    url: f.url,
    sentAt: f.sentAt,
    readAt: null,
    ...(f.ctoAction ? { ctoAction: f.ctoAction } : {}),
    ...(f.ctoCommand ? { ctoCommand: f.ctoCommand } : {}),
  }));

  try {
    await appendEntries(fresh);
  } catch {
    // Server append failed (probably missing `gist` scope) — leave the
    // cursor untouched so we retry the same window next tick.
    return;
  }

  // Advance the cursor to the newest entry we successfully synced.
  let max = cursor ?? "";
  for (const f of list) if (f.sentAt > max) max = f.sentAt;
  if (max) writeCursor(owner, repo, max);
}

export function InboxWatcher(): null {
  const { auth } = useAuth();
  const append = useInboxAppend();
  const running = useRef(false);

  useEffect(() => {
    if (!auth) return;
    const { owner, repo } = auth;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...buildAuthHeaders(auth),
    };
    let stopped = false;

    const tick = async () => {
      if (running.current || stopped) return;
      running.current = true;
      try {
        await runOnce({ owner, repo, headers, appendEntries: append });
      } finally {
        running.current = false;
      }
    };

    void tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
    // `append` is a stable callback that captures auth via context; only
    // re-mount when (owner, repo, token) actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.owner, auth?.repo, auth?.token]);

  return null;
}
