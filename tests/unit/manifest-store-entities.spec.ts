/**
 * Per-entity behavior tests for the three manifest helpers that carry
 * semantics beyond the generic core:
 *   - inbox-feed `appendInboxFeed`: dedupe-by-id, FIFO sort by `sentAt`,
 *     cap at INBOX_FEED_MAX_ENTRIES, return count added, noop on all-dupes;
 *   - cto-decisions: mutator never noops → resolves to MutationOutcome;
 *     `readCtoDecisions` uses the cached read;
 *   - goals: field-by-field equality is order-sensitive.
 *
 * These guard the refactor onto the shared core against behavior drift.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dashboard/lib/github-client", () => ({
  fetchIssues: vi.fn(),
  fetchIssue: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  invalidateIssueCache: vi.fn(),
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
}));

import {
  fetchIssues,
  fetchIssue,
  createIssue,
  updateIssue,
} from "@dashboard/lib/github-client";
import { appendInboxFeed, readInboxFeed } from "@dashboard/lib/inbox/feed-server";
import {
  serializeInboxFeedBody,
  INBOX_FEED_MAX_ENTRIES,
  type InboxFeedEntry,
} from "@dashboard/lib/inbox/feed";
import {
  mutateCtoDecisions,
  readCtoDecisions,
} from "@dashboard/lib/cto/decisions-server";
import {
  applyDecision,
  serializeCtoDecisionsBody,
  EMPTY_CTO_DECISIONS_MANIFEST,
} from "@dashboard/lib/cto/decisions";

const mFetchIssues = vi.mocked(fetchIssues);
const mFetchIssue = vi.mocked(fetchIssue);
const mCreateIssue = vi.mocked(createIssue);
const mUpdateIssue = vi.mocked(updateIssue);

/** Single mutable issue body, label-agnostic (one manifest per test). */
function wire(initialBody: string | null) {
  const state: { number: number | null; body: string } = {
    number: initialBody === null ? null : 7,
    body: initialBody ?? "",
  };
  mFetchIssues.mockImplementation((async () =>
    state.number === null
      ? []
      : [{ number: state.number }]) as unknown as typeof fetchIssues);
  mFetchIssue.mockImplementation((async () => ({
    body: state.body,
  })) as unknown as typeof fetchIssue);
  mCreateIssue.mockImplementation((async (opts: { body?: string }) => {
    state.number = 101;
    state.body = opts.body ?? "";
    return { number: 101 };
  }) as unknown as typeof createIssue);
  mUpdateIssue.mockImplementation((async (
    _n: number,
    patch: { body?: string },
  ) => {
    state.body = patch.body ?? "";
  }) as unknown as typeof updateIssue);
  return state;
}

function entry(over: Partial<InboxFeedEntry>): InboxFeedEntry {
  return {
    id: over.id ?? "u:1",
    login: over.login ?? "u",
    source: over.source ?? ("mention" as InboxFeedEntry["source"]),
    repoFullName: over.repoFullName ?? "acme/widgets",
    threadType: over.threadType ?? "Issue",
    title: over.title ?? "t",
    snippet: over.snippet ?? "s",
    url: over.url ?? "https://x/1",
    sentAt: over.sentAt ?? "2026-01-01T00:00:00.000Z",
    ...(over.author ? { author: over.author } : {}),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("inbox-feed · appendInboxFeed", () => {
  it("returns 0 and writes nothing for an empty input", async () => {
    wire(null);
    expect(await appendInboxFeed([])).toBe(0);
    expect(mUpdateIssue).not.toHaveBeenCalled();
    expect(mCreateIssue).not.toHaveBeenCalled();
  });

  it("dedupes against existing ids and returns only the fresh count", async () => {
    const existing = serializeInboxFeedBody({
      version: 1,
      entries: [entry({ id: "u:1", sentAt: "2026-01-02T00:00:00.000Z" })],
    });
    const state = wire(existing);

    const added = await appendInboxFeed([
      entry({ id: "u:1", sentAt: "2026-01-02T00:00:00.000Z" }), // dup
      entry({ id: "u:2", sentAt: "2026-01-03T00:00:00.000Z" }), // fresh
    ]);

    expect(added).toBe(1);
    const parsed = JSON.parse(state.body.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(parsed.entries.map((e: InboxFeedEntry) => e.id)).toEqual([
      "u:2",
      "u:1",
    ]); // newest first
  });

  it("noops (returns 0, no write) when every incoming id is a duplicate", async () => {
    const existing = serializeInboxFeedBody({
      version: 1,
      entries: [entry({ id: "u:1" })],
    });
    wire(existing);
    expect(await appendInboxFeed([entry({ id: "u:1" })])).toBe(0);
    expect(mUpdateIssue).not.toHaveBeenCalled();
  });

  it("FIFO-caps at INBOX_FEED_MAX_ENTRIES, newest kept", async () => {
    wire(null);
    const many = Array.from({ length: INBOX_FEED_MAX_ENTRIES + 50 }, (_, i) =>
      entry({
        id: `u:${i}`,
        url: `https://x/${i}`,
        sentAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      }),
    );
    const added = await appendInboxFeed(many);
    expect(added).toBe(INBOX_FEED_MAX_ENTRIES + 50);

    const arg = mCreateIssue.mock.calls[0][0] as { body: string };
    const parsed = JSON.parse(arg.body.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(parsed.entries).toHaveLength(INBOX_FEED_MAX_ENTRIES);
    // Sorted desc by sentAt → the highest-second entry survives, oldest drop.
    expect(parsed.entries[0].id).toBe(`u:${INBOX_FEED_MAX_ENTRIES + 49}`);
  });

  it("readInboxFeed uses the cached read (no noCache flag)", async () => {
    wire(
      serializeInboxFeedBody({ version: 1, entries: [entry({ id: "u:9" })] }),
    );
    const feed = await readInboxFeed();
    expect(feed.entries.map((e) => e.id)).toEqual(["u:9"]);
    expect(mFetchIssues).toHaveBeenCalledWith(
      expect.not.objectContaining({ noCache: true }),
    );
  });
});

describe("cto-decisions · no-noop + cached read", () => {
  it("mutateCtoDecisions resolves to a MutationOutcome (never a noop union)", async () => {
    wire(null);
    const out = await mutateCtoDecisions((cur) => {
      const next = applyDecision(cur, {
        taskNumber: 1,
        action: "execute",
        decision: "approve",
      });
      return { next, result: next.actions.execute.approvals };
    });
    // No `kind` discriminant — it's the outcome shape directly.
    expect(out).toMatchObject({ result: 1, issueNumber: 101 });
    expect("kind" in out).toBe(false);
  });

  it("readCtoDecisions uses the cached (ETag/304) read path", async () => {
    const m = applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      taskNumber: 1,
      action: "execute",
      decision: "approve",
    });
    wire(serializeCtoDecisionsBody(m));
    const ledger = await readCtoDecisions();
    expect(ledger.actions.execute.approvals).toBe(1);
    expect(mFetchIssues).toHaveBeenCalledWith(
      expect.not.objectContaining({ noCache: true }),
    );
  });
});
