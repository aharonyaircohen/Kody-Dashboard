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
import type { ServerNotificationType } from "../notifications/prefs-store";

export const INBOX_FEED_LABEL = "kody:inbox-feed";
export const INBOX_FEED_START = "<!-- kody-inbox-feed-start -->";
export const INBOX_FEED_END = "<!-- kody-inbox-feed-end -->";
export const INBOX_FEED_ISSUE_TITLE = "Kody Inbox Feed";
/** Hand-off buffer cap. Big enough to absorb a multi-user mention burst
 *  between client polls; clients dedupe into their own 200-entry gists.
 *  This is only a secondary bound — the real limit is the body-char budget
 *  below, which is what GitHub actually enforces. */
export const INBOX_FEED_MAX_ENTRIES = 500;
/**
 * Hard ceiling on the serialized issue-body length. GitHub rejects issue
 * bodies over 65536 chars with a 422; a rejected PATCH then reads back
 * unchanged and the CAS loop reports a bogus "write conflict" — which is
 * exactly how the feed silently stopped appending once it bloated past the
 * limit. We keep well under 65536 so the preamble + fence markers always fit.
 */
export const INBOX_FEED_MAX_BODY_CHARS = 50000;
/**
 * Trim target — once the body exceeds `MAX_BODY_CHARS`, drop oldest entries
 * down to this size, NOT just under the cap. Leaves comfortable headroom so
 * the next 10–20 appends fit without re-triggering the (somewhat expensive)
 * trim loop. Past regression: trimming only to "just under cap" let a single
 * burst of fat CTO recs push us right back over on the very next write.
 */
export const INBOX_FEED_TARGET_BODY_CHARS = 40000;

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
  /** Action verb parsed from the raw comment body (recs only). */
  ctoAction?: string;
  /** Exact `@kody …` command from the raw body's `kody-cmd` line. */
  ctoCommand?: string;
  /** Emitting agent slug from the raw body's `kody-agent` line (recs only). */
  ctoAgent?: string;
  /** Emitting agentResponsibility slug from the raw body's `kody-agentResponsibility` line — the trust key. */
  ctoAgentResponsibility?: string;
  /**
   * Server-classified notification category for this entry (`chat-response`,
   * `task-assigned`, …), computed from the source event at write time. Drives
   * the inbox row's "Mute this type" action. Absent when the event maps to no
   * mute-able type, or on entries written before this field existed.
   */
  category?: ServerNotificationType;
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

/**
 * Cap a *newest-first* entry list so the serialized body stays within GitHub's
 * issue-body limit. Trims the oldest entries until both bounds are satisfied:
 * the entry-count cap and `INBOX_FEED_MAX_BODY_CHARS`. The byte budget is the
 * binding constraint — fat CTO-recommendation entries blow it long before the
 * count cap. Self-healing: an already-oversized feed shrinks to fit on the
 * next append, which makes the PATCH succeed again.
 *
 * Two-step trim: once we're over `MAX_BODY_CHARS`, we keep dropping until the
 * body fits under `TARGET_BODY_CHARS` (not just MAX). This leaves room for
 * many subsequent appends before another trim is needed — without it, a feed
 * that grazes the cap re-triggers trim on every single write and a single
 * burst of fat entries flips us right back over.
 */
export function capFeedEntries(entries: InboxFeedEntry[]): InboxFeedEntry[] {
  let kept = entries.slice(0, INBOX_FEED_MAX_ENTRIES);
  const overCap = (list: InboxFeedEntry[]): boolean =>
    serializeInboxFeedBody({ version: 1, entries: list }).length >
    INBOX_FEED_MAX_BODY_CHARS;
  const overTarget = (list: InboxFeedEntry[]): boolean =>
    serializeInboxFeedBody({ version: 1, entries: list }).length >
    INBOX_FEED_TARGET_BODY_CHARS;
  if (!overCap(kept)) return kept;
  while (kept.length > 0 && overTarget(kept)) {
    // Drop ~10% of the oldest tail per pass (min 1) so we converge in a few
    // iterations instead of one-at-a-time on a badly bloated feed.
    const drop = Math.max(1, Math.floor(kept.length * 0.1));
    kept = kept.slice(0, kept.length - drop);
  }
  return kept;
}

/** Stable per-(login, thread/comment) id so re-deliveries dedupe. */
export function feedEntryId(login: string, url: string): string {
  return `${login}:${url}`;
}

/**
 * Collapse key for a recommendation entry: `(login, repo, agent, task#)`.
 * An agent re-posts a fresh recommendation *comment* for the same task
 * every tick — each has a unique comment URL, so id-dedup can't catch it and
 * the inbox grows without bound. Keying recs by the *task* they're about (not
 * which comment carried them, and deliberately NOT the action verb — the
 * parsed verb drifts across re-posts and each agentIdentity guarantees one live rec
 * per task) lets the newest rec supersede every prior one for that task. The
 * **agent slug is part of the key** so a CTO rec and a QA rec on the same task
 * stay distinct instead of one clobbering the other. Returns null for anything
 * without `ctoAction` (not a recommendation) — it keeps plain id-dedup, so
 * every distinct mention is its own entry.
 */
export function ctoFeedKey(entry: {
  login?: string;
  repoFullName: string;
  url: string;
  ctoAction?: string;
  ctoAgent?: string;
  title?: string;
  snippet?: string;
}): string | null {
  // A rec either carries a parsed `ctoAction` (new entries) or — for the
  // backlog written before that was reliable — still bears the prose marker
  // in its title/snippet (backticks are stripped but the marker is plain
  // text, so it survives). Recognising the legacy shape lets the existing
  // flood self-heal, not just future re-posts.
  const isRec =
    !!entry.ctoAction ||
    /CTO recommendation/i.test(`${entry.title ?? ""} ${entry.snippet ?? ""}`);
  if (!isRec) return null;
  const m = entry.url.match(/\/(?:issues|pull|discussions)\/(\d+)/);
  if (!m) return null;
  // The shared feed mixes logins, so it scopes the key by login; a
  // per-user gist is already single-login and omits it. Legacy entries with
  // no slug collapse under "cto" — they were all the CTO's.
  const prefix = entry.login ? `${entry.login}:` : "";
  const agent = entry.ctoAgent ?? "cto";
  return `${prefix}${entry.repoFullName.toLowerCase()}:${agent}:${m[1]}`;
}
