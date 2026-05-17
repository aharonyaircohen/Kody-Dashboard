/**
 * Unit tests for the inbox-feed manifest — pure parse/serialize round-trip
 * plus the tolerant-parser contract (never throws, empty on garbage).
 */
import { describe, it, expect } from "vitest";

import {
  parseInboxFeedBody,
  serializeInboxFeedBody,
  feedEntryId,
  EMPTY_INBOX_FEED_MANIFEST,
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
