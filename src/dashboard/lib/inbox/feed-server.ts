/**
 * @fileType utility
 * @domain kody
 * @pattern inbox-feed-cas
 * @ai-summary Server-only read/append over the inbox-feed manifest issue.
 *   The read → mutate → write → verify cycle (in-process per-repo mutex +
 *   retry) now lives in the shared `manifest-store` core; this file is just
 *   the inbox-feed config plus the original public API.
 *
 *   `appendInboxFeed` keeps its bespoke semantics (dedupe-by-id against the
 *   *fresh* read each attempt, FIFO sort by `sentAt`, cap at
 *   INBOX_FEED_MAX_ENTRIES, return the count actually added) by expressing
 *   them as the core's mutator: nothing new → noop with result 0; otherwise
 *   write the capped+sorted list and report `fresh.length`. `readInboxFeed`
 *   uses the cached (ETag/304) read — same as before.
 */
import {
  createManifestStore,
  type ManifestMutationOutcome,
} from "../manifest-store";
import {
  EMPTY_INBOX_FEED_MANIFEST,
  INBOX_FEED_LABEL,
  INBOX_FEED_ISSUE_TITLE,
  INBOX_FEED_MAX_ENTRIES,
  parseInboxFeedBody,
  serializeInboxFeedBody,
  type InboxFeedEntry,
  type InboxFeedManifest,
} from "./feed";

function manifestsEqual(a: InboxFeedManifest, b: InboxFeedManifest): boolean {
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    if (a.entries[i].id !== b.entries[i].id) return false;
  }
  return true;
}

const store = createManifestStore<InboxFeedManifest>({
  label: INBOX_FEED_LABEL,
  title: INBOX_FEED_ISSUE_TITLE,
  name: "inbox-feed",
  lockPrefix: "inbox-feed:",
  parse: parseInboxFeedBody,
  serialize: serializeInboxFeedBody,
  empty: () => ({ ...EMPTY_INBOX_FEED_MANIFEST, entries: [] }),
  equals: manifestsEqual,
});

/**
 * Read the current feed. Cached path is fine for the API read; the append
 * path always reads fresh inside the CAS loop.
 */
export function readInboxFeed(): Promise<InboxFeedManifest> {
  return store.readCached();
}

/**
 * Append entries to the feed, deduping by `id` and FIFO-capping at
 * INBOX_FEED_MAX_ENTRIES. Best-effort: callers (webhook) must not let a
 * feed-write failure break delivery — wrap in try/catch and swallow.
 * Returns the number of entries actually added (0 if all were duplicates).
 */
export async function appendInboxFeed(
  incoming: InboxFeedEntry[],
  maxAttempts = 3,
): Promise<number> {
  if (incoming.length === 0) return 0;

  const outcome:
    | ManifestMutationOutcome<InboxFeedManifest, number>
    | { kind: "noop"; result: number } = await store.mutate<number>(
    (current) => {
      const seen = new Set(current.entries.map((e) => e.id));
      const fresh = incoming.filter((e) => !seen.has(e.id));
      if (fresh.length === 0) return { kind: "noop", result: 0 };

      const all = [...fresh, ...current.entries];
      all.sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      );
      const next: InboxFeedManifest = {
        version: 1,
        entries: all.slice(0, INBOX_FEED_MAX_ENTRIES),
      };
      return { next, result: fresh.length };
    },
    { maxAttempts },
  );

  return outcome.result;
}
