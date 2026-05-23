/**
 * Unit tests for the inbox-feed manifest — pure parse/serialize round-trip
 * plus the tolerant-parser contract (never throws, empty on garbage).
 */
import { describe, it, expect } from "vitest";

import {
  parseInboxFeedBody,
  serializeInboxFeedBody,
  capFeedEntries,
  feedEntryId,
  EMPTY_INBOX_FEED_MANIFEST,
  INBOX_FEED_MAX_ENTRIES,
  INBOX_FEED_MAX_BODY_CHARS,
  type InboxFeedEntry,
  type InboxFeedManifest,
} from "@dashboard/lib/inbox/feed";

const entry = {
  id: "alice:https://github.com/o/r/issues/1#c5",
  login: "alice",
  source: "mention" as const,
  repoFullName: "o/r",
  threadType: "Issue",
  title: "Something broke",
  snippet: "hey @alice can you look",
  author: "bob",
  url: "https://github.com/o/r/issues/1#c5",
  sentAt: "2026-05-17T10:00:00.000Z",
};

const manifest: InboxFeedManifest = { version: 1, entries: [entry] };

describe("feedEntryId", () => {
  it("is stable per (login, url) so re-deliveries dedupe", () => {
    expect(feedEntryId("alice", "https://x/1")).toBe("alice:https://x/1");
    expect(feedEntryId("alice", "https://x/1")).toBe(
      feedEntryId("alice", "https://x/1"),
    );
  });
});

describe("capFeedEntries (body-size budget)", () => {
  const big = (i: number): InboxFeedEntry => ({
    ...entry,
    id: `u:${i}`,
    url: `https://github.com/o/r/issues/${i}#c${i}`,
    title: `Recommendation number ${i} with a fairly long descriptive title`,
    snippet: "x".repeat(120),
    sentAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  });

  it("keeps the whole list when it already fits", () => {
    const few = [big(1), big(2), big(3)];
    expect(capFeedEntries(few)).toHaveLength(3);
  });

  it("trims oldest entries so the serialized body stays under the limit", () => {
    const many = Array.from({ length: INBOX_FEED_MAX_ENTRIES + 100 }, (_, i) =>
      big(i),
    );
    const kept = capFeedEntries(many);
    expect(kept.length).toBeLessThan(many.length);
    expect(kept.length).toBeLessThanOrEqual(INBOX_FEED_MAX_ENTRIES);
    const body = serializeInboxFeedBody({ version: 1, entries: kept });
    expect(body.length).toBeLessThanOrEqual(INBOX_FEED_MAX_BODY_CHARS);
    // Newest-first input → the head (newest) is what survives.
    expect(kept[0].id).toBe("u:0");
  });
});

describe("serialize/parse round-trip", () => {
  it("recovers the manifest from its issue-body form", () => {
    const body = serializeInboxFeedBody(manifest);
    expect(parseInboxFeedBody(body)).toEqual(manifest);
  });

  it("embeds the JSON inside the comment markers", () => {
    const body = serializeInboxFeedBody(manifest);
    expect(body).toContain("<!-- kody-inbox-feed-start -->");
    expect(body).toContain("<!-- kody-inbox-feed-end -->");
    expect(body).toContain('"login": "alice"');
  });
});

describe("parseInboxFeedBody tolerance", () => {
  it("returns the empty manifest for null/empty/garbage", () => {
    expect(parseInboxFeedBody(null)).toEqual(EMPTY_INBOX_FEED_MANIFEST);
    expect(parseInboxFeedBody("")).toEqual(EMPTY_INBOX_FEED_MANIFEST);
    expect(parseInboxFeedBody("no markers here")).toEqual(
      EMPTY_INBOX_FEED_MANIFEST,
    );
  });

  it("drops entries missing required fields, keeps valid ones", () => {
    const mixed: InboxFeedManifest = {
      version: 1,
      // @ts-expect-error — intentionally malformed second entry
      entries: [entry, { id: "x", login: "y" }],
    };
    const parsed = parseInboxFeedBody(serializeInboxFeedBody(mixed));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].id).toBe(entry.id);
  });

  it("survives a corrupt JSON block", () => {
    const body =
      "<!-- kody-inbox-feed-start -->\n\n```json\n{ not valid\n```\n\n<!-- kody-inbox-feed-end -->\n";
    expect(parseInboxFeedBody(body)).toEqual(EMPTY_INBOX_FEED_MANIFEST);
  });
});
