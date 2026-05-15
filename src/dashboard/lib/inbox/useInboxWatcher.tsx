"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern inbox-watcher
 * @ai-summary Polls GitHub's per-repo notifications API every 60s with the
 *   user's PAT, finds new mentions/reviews/assignments, enriches them with
 *   the latest comment for a snippet, and posts them to the server inbox
 *   route. Mount once at the app root.
 *
 *   Why GitHub notifications over comment-body scraping: GitHub already
 *   computes "did this @mention me", "was I review-requested", etc., and
 *   surfaces them via /notifications with a `reason` field. We just trust
 *   GitHub's classification and re-skin it as our durable inbox.
 *
 *   Per-PAT rate-budget — calls are signed with the user's token, not the
 *   shared dashboard bot token, so we don't add to the existing 5000/hr
 *   constraint described in CLAUDE.md. We also send `If-Modified-Since`
 *   so quiet periods cost 1 free 304 per minute.
 */
import { useEffect, useRef } from "react";
import { useAuth } from "../auth-context";
import { useInboxAppend } from "./useInbox";
import { buildSnippet, type InboxEntry, type InboxSource } from "./types";

const POLL_INTERVAL_MS = 60_000;
const LAST_MODIFIED_KEY = (owner: string, repo: string) =>
  `kody.inbox.lastModified.${owner}/${repo}`;
const SEEN_KEY = (owner: string, repo: string) =>
  `kody.inbox.seenIds.${owner}/${repo}`;
const SEEN_CAP = 500;

interface GitHubNotification {
  id: string;
  reason: string;
  updated_at: string;
  subject: {
    title: string;
    url: string | null;
    latest_comment_url: string | null;
    type: string; // "Issue", "PullRequest", "Discussion", ...
  };
  repository?: { full_name?: string };
}

interface SubjectDetails {
  body?: string;
  html_url?: string;
  user?: { login?: string };
}

function mapReason(reason: string): InboxSource {
  switch (reason) {
    case "mention":
      return "mention";
    case "team_mention":
      return "team_mention";
    case "review_requested":
      return "review_requested";
    case "assign":
      return "assigned";
    case "author":
    case "comment":
      return "comment";
    case "subscribed":
      return "subscribed";
    default:
      return "other";
  }
}

const ROUTE_REASONS = new Set([
  "mention",
  "team_mention",
  "review_requested",
  "assign",
]);

function readSeen(owner: string, repo: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_KEY(owner, repo));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(owner: string, repo: string, set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    const arr = [...set].slice(-SEEN_CAP);
    window.localStorage.setItem(SEEN_KEY(owner, repo), JSON.stringify(arr));
  } catch {
    // localStorage may be full / unavailable — ignore.
  }
}

async function fetchSubjectDetails(
  token: string,
  url: string,
): Promise<SubjectDetails | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as SubjectDetails;
  } catch {
    return null;
  }
}

function buildEntryId(
  n: GitHubNotification,
  latestCommentUrl: string | null,
): string {
  // GitHub thread id changes when the reason changes; tack on the latest
  // comment URL (or updated_at) so a new comment surfaces as a new entry.
  const suffix = latestCommentUrl ?? n.updated_at;
  return `gh:${n.id}:${suffix}`;
}

async function runOnce(opts: {
  owner: string;
  repo: string;
  token: string;
  lastModified: string | null;
  setLastModified: (value: string | null) => void;
  appendEntries: (entries: InboxEntry[]) => Promise<void>;
}): Promise<void> {
  const { owner, repo, token, lastModified, setLastModified, appendEntries } =
    opts;
  const url = `https://api.github.com/repos/${owner}/${repo}/notifications?all=false&participating=false`;
  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    return; // network hiccup — try again next tick
  }
  if (res.status === 304) return; // nothing new
  if (!res.ok) return;
  const nextLastModified = res.headers.get("last-modified");
  if (nextLastModified) setLastModified(nextLastModified);

  const list = (await res.json().catch(() => null)) as
    | GitHubNotification[]
    | null;
  if (!Array.isArray(list) || list.length === 0) return;

  const seen = readSeen(owner, repo);
  const fresh: InboxEntry[] = [];

  for (const n of list) {
    if (!ROUTE_REASONS.has(n.reason)) continue;
    const id = buildEntryId(n, n.subject.latest_comment_url);
    if (seen.has(id)) continue;

    let snippet = "";
    let author: string | undefined;
    let entryUrl = "";

    const detailUrl = n.subject.latest_comment_url ?? n.subject.url;
    if (detailUrl) {
      const detail = await fetchSubjectDetails(token, detailUrl);
      if (detail) {
        snippet = buildSnippet(detail.body);
        author = detail.user?.login;
        entryUrl = detail.html_url ?? "";
      }
    }
    if (!entryUrl) {
      // Fall back to a constructed URL from subject.url (API form). Skip if
      // we can't synthesise one.
      const apiUrl = n.subject.url ?? "";
      const m = apiUrl.match(
        /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/(issues|pulls|discussions)\/(\d+)$/,
      );
      if (m) {
        const kind = m[3] === "pulls" ? "pull" : m[3];
        entryUrl = `https://github.com/${m[1]}/${m[2]}/${kind}/${m[4]}`;
      }
    }
    if (!entryUrl) continue;

    const entry: InboxEntry = {
      id,
      source: mapReason(n.reason),
      repoFullName: n.repository?.full_name ?? `${owner}/${repo}`,
      threadType: n.subject.type,
      title: n.subject.title,
      snippet,
      author,
      url: entryUrl,
      sentAt: n.updated_at,
      readAt: null,
    };
    fresh.push(entry);
    seen.add(id);
  }

  if (fresh.length === 0) return;
  try {
    await appendEntries(fresh);
    writeSeen(owner, repo, seen);
  } catch {
    // Server append failed (probably missing `gist` scope) — keep the
    // ids out of the seen set so we retry next tick.
  }
}

export function InboxWatcher(): null {
  const { auth } = useAuth();
  const append = useInboxAppend();
  const running = useRef(false);

  useEffect(() => {
    if (!auth) return;
    const { owner, repo, token } = auth;
    let stopped = false;

    const readLastModified = (): string | null => {
      if (typeof window === "undefined") return null;
      try {
        return window.localStorage.getItem(LAST_MODIFIED_KEY(owner, repo));
      } catch {
        return null;
      }
    };
    const writeLastModified = (v: string | null): void => {
      if (typeof window === "undefined") return;
      try {
        if (v) window.localStorage.setItem(LAST_MODIFIED_KEY(owner, repo), v);
      } catch {
        // ignore
      }
    };

    const tick = async () => {
      if (running.current || stopped) return;
      running.current = true;
      try {
        await runOnce({
          owner,
          repo,
          token,
          lastModified: readLastModified(),
          setLastModified: writeLastModified,
          appendEntries: append,
        });
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
