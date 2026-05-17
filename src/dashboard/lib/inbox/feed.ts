/**
 * @fileType utility
 * @domain kody
 * @pattern inbox-feed-manifest
 * @ai-summary Shared types + parse/serialize for the per-repo inbox **feed**.
 *
 *   The feed is the durable, server-written half of the inbox. The webhook
 *   receiver scrapes `@login` mentions out of every event body (the exact
 *   same detection as `push/mention-dispatch.ts`) and appends one feed entry
 *   per mentioned login here, using the bot token. Each user's dashboard
 *   later pulls *its own* slice (filtered by login) into the user's private
 *   inbox gist.
 *
 *   This decouples mention detection from "did the logged-in user have a tab
 *   open / watch the repo / get a GitHub notification" — the bug that made
 *   the inbox miss mentions that push delivered. One detector now feeds both.
 *
 *   Stored in a single GitHub issue labelled `kody:inbox-feed`, same
 *   JSON-in-comment-markers pattern as `push.ts`. FIFO-capped — the feed is a
 *   short-lived hand-off buffer, not an archive (the per-user gist is the
 *   archive).
 */
import type { InboxSource } from "./types";

export const INBOX_FEED_LABEL = "kody:inbox-feed";
export const INBOX_FEED_START = "<!-- kody-inbox-feed-start -->";
export const INBOX_FEED_END = "<!-- kody-inbox-feed-end -->";
export const INBOX_FEED_ISSUE_TITLE = "Kody Inbox Feed";
/** Hand-off buffer cap. Big enough to absorb a multi-user mention burst
 *  between client polls; clients dedupe into their own 200-entry gists. */
export const INBOX_FEED_MAX_ENTRIES = 500;

export interface InboxFeedEntry {
  /** Stable opaque id — `${login}:${url}`. Re-deliveries dedupe; a new
   *  comment has a new url so it surfaces as a new entry. */
  id: string;
  /** Lowercased GitHub login of the *mentioned* user this entry targets. */
  login: string;
  source: InboxSource;
  repoFullName: string;
  /** `Issue` / `PullRequest` / `Discussion` / `Commit`. */
  threadType: string;
  title: string;
  /** Plain-text snippet (code fences stripped). May be empty. */
  snippet: string;
  /** Login of the author of the triggering event, if known. */
  author?: string;
  url: string;
  /** ISO timestamp the webhook produced this entry. */
  sentAt: string;
  /** CTO action verb parsed from the raw comment body (CTO recs only). */
  ctoAction?: string;
}

export interface InboxFeedManifest {
  version: 1;
  entries: InboxFeedEntry[];
}

export const EMPTY_INBOX_FEED_MANIFEST: InboxFeedManifest = {
  version: 1,
  entries: [],
};

function isFeedEntry(v: unknown): v is InboxFeedEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.login === "string" &&
    typeof e.repoFullName === "string" &&
    typeof e.url === "string" &&
    typeof e.title === "string" &&
    typeof e.snippet === "string" &&
    typeof e.sentAt === "string"
  );
}

export function parseInboxFeedBody(
  body: string | null | undefined,
): InboxFeedManifest {
  if (!body) return { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] };
  const start = body.indexOf(INBOX_FEED_START);
  const end = body.indexOf(INBOX_FEED_END);
  if (start === -1 || end === -1 || end < start) {
    return { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] };
  }
  const inner = body.slice(start + INBOX_FEED_START.length, end);
  const fenceOpen = inner.indexOf("```");
  const fenceClose = inner.lastIndexOf("```");
  if (fenceOpen === -1 || fenceClose === -1 || fenceClose === fenceOpen) {
    return { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] };
  }
  const afterOpen = inner.indexOf("\n", fenceOpen);
  if (afterOpen === -1) return { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] };
  const json = inner.slice(afterOpen + 1, fenceClose).trim();
  if (!json) return { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] };

  try {
    const parsed = JSON.parse(json) as Partial<InboxFeedManifest>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries))
      return { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] };
    const entries = parsed.entries.filter(isFeedEntry);
    return { version: 1, entries };
  } catch {
    return { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] };
  }
}

export function serializeInboxFeedBody(manifest: InboxFeedManifest): string {
  const preamble =
    "> Kody inbox-feed manifest — the webhook receiver appends `@mention`\n" +
    "> entries here (bot token); each user's dashboard pulls its own slice\n" +
    "> into its private inbox gist. Edited automatically.\n\n";
  const json = JSON.stringify(manifest, null, 2);
  return `${preamble}${INBOX_FEED_START}\n\n\`\`\`json\n${json}\n\`\`\`\n\n${INBOX_FEED_END}\n`;
}

/** Stable per-(login, thread/comment) id so re-deliveries dedupe. */
export function feedEntryId(login: string, url: string): string {
  return `${login}:${url}`;
}
