/**
 * @fileType utility
 * @domain kody
 * @pattern inbox-feed-cas
 * @ai-summary Server-only read/append over the inbox-feed manifest issue.
 *   Mirrors `push-server.ts` exactly — per-repo mutex + verify-after-write
 *   retry so concurrent webhook deliveries (the only writers) can't silently
 *   overwrite each other.
 *
 *   Kept separate from push-server.ts on purpose: different manifest shape,
 *   write-heavy from webhooks rather than from the subscribe UI. A future
 *   refactor can extract a shared "manifest-issue helper".
 */
import {
  fetchIssues,
  fetchIssue,
  createIssue,
  updateIssue,
  invalidateIssueCache,
  getOwner,
  getRepo,
} from "../github-client";
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

const locks = new Map<string, Promise<unknown>>();

async function withRepoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(
    () => fn(),
    () => fn(),
  );
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

interface FeedRef {
  number: number | null;
  manifest: InboxFeedManifest;
}

async function readFeedFresh(): Promise<FeedRef> {
  const issues = await fetchIssues({
    state: "open",
    labels: INBOX_FEED_LABEL,
    perPage: 5,
    noCache: true,
  });
  if (!issues.length) {
    return {
      number: null,
      manifest: { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] },
    };
  }
  const first = [...issues].sort((a, b) => a.number - b.number)[0];
  const full = await fetchIssue(first.number, { noCache: true });
  return {
    number: first.number,
    manifest: parseInboxFeedBody(full?.body ?? ""),
  };
}

async function writeFeed(
  next: InboxFeedManifest,
  existingNumber: number | null,
): Promise<number> {
  const body = serializeInboxFeedBody(next);
  if (existingNumber !== null) {
    await updateIssue(existingNumber, { body });
    return existingNumber;
  }
  const created = await createIssue({
    title: INBOX_FEED_ISSUE_TITLE,
    body,
    labels: [INBOX_FEED_LABEL],
  });
  return created.number;
}

function manifestsEqual(a: InboxFeedManifest, b: InboxFeedManifest): boolean {
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    if (a.entries[i].id !== b.entries[i].id) return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the current feed (cached path is fine for the API read; callers that
 *  need a guaranteed-fresh view use the mutate path). */
export async function readInboxFeed(): Promise<InboxFeedManifest> {
  const issues = await fetchIssues({
    state: "open",
    labels: INBOX_FEED_LABEL,
    perPage: 5,
  });
  if (!issues.length) return { ...EMPTY_INBOX_FEED_MANIFEST, entries: [] };
  const first = [...issues].sort((a, b) => a.number - b.number)[0];
  const full = await fetchIssue(first.number);
  return parseInboxFeedBody(full?.body ?? "");
}

/**
 * Append entries to the feed, deduping by `id` and FIFO-capping at
 * INBOX_FEED_MAX_ENTRIES. Best-effort: callers (webhook) must not let a
 * feed-write failure break delivery — wrap in try/catch and swallow.
 */
export async function appendInboxFeed(
  incoming: InboxFeedEntry[],
  maxAttempts = 3,
): Promise<number> {
  if (incoming.length === 0) return 0;
  const lockKey = `inbox-feed:${getOwner()}/${getRepo()}`;

  return withRepoLock(lockKey, async () => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ref = await readFeedFresh();
      const seen = new Set(ref.manifest.entries.map((e) => e.id));
      const fresh = incoming.filter((e) => !seen.has(e.id));
      if (fresh.length === 0) return 0;

      const all = [...fresh, ...ref.manifest.entries];
      all.sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      );
      const next: InboxFeedManifest = {
        version: 1,
        entries: all.slice(0, INBOX_FEED_MAX_ENTRIES),
      };

      const issueNumber = await writeFeed(next, ref.number);
      invalidateIssueCache(issueNumber);

      const verify = await fetchIssue(issueNumber, { noCache: true });
      const verifyManifest = parseInboxFeedBody(verify?.body ?? "");
      if (manifestsEqual(verifyManifest, next)) return fresh.length;

      lastError = new Error(
        `inbox-feed write conflict on issue #${issueNumber} (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(50 * attempt + Math.floor(Math.random() * 50));
    }
    throw (
      lastError ??
      new Error(`inbox-feed write conflict: failed after ${maxAttempts}`)
    );
  });
}
