/**
 * @fileType utility
 * @domain kody
 * @pattern inbox-types
 * @ai-summary Shared types and constants for the per-user, per-repo inbox.
 *
 *   Storage: one **private gist per repo**, owned by the logged-in user.
 *   Discoverability: gists are looked up by their `description` field, which
 *   is namespaced `kody-inbox:<owner>/<repo>` so a user with many connected
 *   repos ends up with N distinct gists. The file inside the gist is named
 *   `inbox.json` and carries the manifest JSON.
 *
 *   The dashboard *server* writes to the gist using the user's PAT (passed
 *   per-request via `x-kody-token`) — never using the bot token, because the
 *   inbox belongs to the user, not to the deployment. Webhook receivers
 *   therefore can't write the gist directly; instead they append to the
 *   server-side **inbox feed** (`feed.ts`, bot-token), and the client
 *   watcher pulls this user's slice of that feed down into the gist via the
 *   API routes. See `useInboxWatcher.tsx`.
 *
 *   Cap: the manifest stores the last `INBOX_MAX_ENTRIES` entries. Older
 *   ones drop off — this is an inbox, not an archive.
 */
export const INBOX_GIST_DESCRIPTION_PREFIX = "kody-inbox:";
export const INBOX_GIST_FILE = "inbox.json";
export const INBOX_MAX_ENTRIES = 200;
export const INBOX_MANIFEST_VERSION = 1 as const;

/** Why this entry was added to the inbox. Drives icon + tone in the UI. */
export type InboxSource =
  | "mention"
  | "comment"
  | "review_requested"
  | "assigned"
  | "team_mention"
  | "subscribed"
  | "other";

export interface InboxEntry {
  /** Stable opaque ID — recommended shape: `${threadType}:${threadId}:${commentId|updated_at}`. */
  id: string;
  source: InboxSource;
  /** `owner/repo` of the thread. */
  repoFullName: string;
  /** `Issue` / `PullRequest` / `Discussion` / `Commit` / `Release`. */
  threadType: string;
  title: string;
  /** Plain-text snippet (≤240 chars, code fences stripped). May be empty. */
  snippet: string;
  /** GitHub login of the author of the triggering event, if known. */
  author?: string;
  /** Deep link — clicked rows open this in a new tab. */
  url: string;
  /** ISO timestamp the entry was first added. */
  sentAt: string;
  /** ISO timestamp the user marked it read, or null. */
  readAt: string | null;
}

export interface InboxManifest {
  version: typeof INBOX_MANIFEST_VERSION;
  entries: InboxEntry[];
}

export const EMPTY_INBOX_MANIFEST: InboxManifest = {
  version: INBOX_MANIFEST_VERSION,
  entries: [],
};

export function inboxGistDescription(owner: string, repo: string): string {
  return `${INBOX_GIST_DESCRIPTION_PREFIX}${owner}/${repo}`;
}

/** Tolerant parser — never throws, returns the empty manifest on bad input. */
export function parseInboxManifest(
  raw: string | null | undefined,
): InboxManifest {
  if (!raw) return { ...EMPTY_INBOX_MANIFEST, entries: [] };
  try {
    const obj = JSON.parse(raw) as Partial<InboxManifest> | null;
    if (!obj || typeof obj !== "object")
      return { ...EMPTY_INBOX_MANIFEST, entries: [] };
    const entries = Array.isArray(obj.entries)
      ? obj.entries.filter(isValidEntry)
      : [];
    return { version: INBOX_MANIFEST_VERSION, entries };
  } catch {
    return { ...EMPTY_INBOX_MANIFEST, entries: [] };
  }
}

export function serializeInboxManifest(m: InboxManifest): string {
  return JSON.stringify(
    { version: INBOX_MANIFEST_VERSION, entries: m.entries },
    null,
    2,
  );
}

function isValidEntry(x: unknown): x is InboxEntry {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.repoFullName === "string" &&
    typeof e.url === "string" &&
    typeof e.title === "string" &&
    typeof e.snippet === "string" &&
    typeof e.sentAt === "string" &&
    (e.readAt === null || typeof e.readAt === "string")
  );
}

/** Strip code fences + collapse whitespace for the inbox preview.
 *
 *  Inline backtick-quoted strings that look like identifiers (single-word
 *  actions such as `execute`, `qa-review`, `fix`, `approve`) are kept as-is
 *  since they carry more meaning than a generic "[code]" placeholder.
 *  Everything else (multi-word strings, strings with punctuation, file paths,
 *  etc.) is collapsed to "[code]". */
export function buildSnippet(
  body: string | null | undefined,
  max = 240,
): string {
  if (!body) return "";
  return body
    .replace(/```[\s\S]*?```/g, "[code]")
    // Preserve single-word action names in backticks; collapse everything
    // else to [code]. A "word" here is alphanumerics, underscores, hyphens.
    .replace(/`([a-zA-Z0-9_-]+)`/g, (_, word) => word)
    // Collapse any remaining backtick pairs (multi-word or punctuation)
    .replace(/`[^`]*`/g, "[code]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
