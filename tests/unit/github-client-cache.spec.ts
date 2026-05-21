/**
 * Unit tests for github-client's cache + conditional-request machinery
 * (src/dashboard/lib/github-client.ts). This file was at ~2.8% coverage
 * despite CLAUDE.md flagging its rate-limit rules as load-bearing — past
 * regressions of these exact invariants caused multi-hour dashboard
 * outages (the shared 5000 req/hr token drains, everything goes dark).
 *
 * The invariants under test:
 *   1. A warm cache hit makes ZERO GitHub calls.
 *   2. Post-TTL revalidation replays the cached ETag via `If-None-Match`...
 *   3. ...and a 304 refreshes the TTL on existing data — no re-download,
 *      no rate cost.
 *   4. `noCache` skips the cache read, omits `If-None-Match`, and skips the
 *      cache write (it must never poison the shared cache).
 *   5. A 404 resolves to null (not a throw).
 *   6. `invalidateIssueCache(n)` clears the single issue AND every listing;
 *      with no arg it clears only listings.
 *
 * Octokit is mocked at the `@octokit/rest` boundary so a fake REST client
 * drives `issues.get` / `issues.listForRepo` without touching the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { issuesGet, listForRepo } = vi.hoisted(() => ({
  issuesGet: vi.fn(),
  listForRepo: vi.fn(),
}));

vi.mock("@octokit/plugin-throttling", () => ({ throttling: () => ({}) }));
vi.mock("@octokit/rest", () => {
  class FakeOctokit {
    issues = { get: issuesGet, listForRepo: listForRepo };
    static plugin() {
      return FakeOctokit;
    }
  }
  return { Octokit: FakeOctokit };
});

import {
  fetchIssue,
  fetchIssues,
  invalidateIssueCache,
  setGitHubContext,
  clearGitHubContext,
  clearCache,
  getCacheStats,
} from "@dashboard/lib/github-client";

// Minimal shapes matching what the mappers in github-client read.
function issuePayload(number: number, overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: number * 100,
      number,
      title: `issue-${number}`,
      body: "body",
      state: "open",
      labels: [],
      milestone: null,
      assignees: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      closed_at: null,
      html_url: `https://github.com/acme/widgets/issues/${number}`,
      ...overrides,
    },
    headers: { etag: '"etag-v1"' },
  };
}

function listPayload(numbers: number[], etag = '"list-v1"') {
  return {
    data: numbers.map((n) => ({
      id: n * 100,
      number: n,
      title: `issue-${n}`,
      body: "body",
      state: "open",
      labels: [],
      milestone: null,
      assignees: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      closed_at: null,
      html_url: `https://github.com/acme/widgets/issues/${n}`,
    })),
    headers: { etag },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setGitHubContext("acme", "widgets", "test-token");
  clearCache();
});

afterEach(() => {
  vi.useRealTimers();
  clearCache();
  clearGitHubContext();
});

describe("fetchIssue caching", () => {
  it("serves a warm cache hit without a second GitHub call", async () => {
    issuesGet.mockResolvedValueOnce(issuePayload(42));

    const first = await fetchIssue(42);
    const second = await fetchIssue(42);

    expect(first?.number).toBe(42);
    expect(second).toEqual(first);
    expect(issuesGet).toHaveBeenCalledTimes(1); // second read hit memory
  });

  it("replays the cached ETag and treats 304 as a free refresh", async () => {
    vi.useFakeTimers();
    issuesGet.mockResolvedValueOnce(issuePayload(42)); // 200 + etag-v1

    const first = await fetchIssue(42, { ttl: 1000 });

    // Expire the entry, then revalidate.
    vi.advanceTimersByTime(1001);
    issuesGet.mockRejectedValueOnce({ status: 304 });

    const revalidated = await fetchIssue(42, { ttl: 1000 });

    expect(revalidated).toEqual(first); // stale data reused, not re-downloaded
    expect(issuesGet).toHaveBeenCalledTimes(2);
    // The revalidation request MUST carry If-None-Match with the stored ETag.
    expect(issuesGet.mock.calls[1][0]).toMatchObject({
      headers: { "If-None-Match": '"etag-v1"' },
    });

    // 304 refreshed the TTL, so an immediate re-read is a cache hit (no call).
    const third = await fetchIssue(42, { ttl: 1000 });
    expect(third).toEqual(first);
    expect(issuesGet).toHaveBeenCalledTimes(2);
  });

  it("returns null on 404 instead of throwing", async () => {
    issuesGet.mockRejectedValueOnce({ status: 404 });
    expect(await fetchIssue(999)).toBeNull();
  });

  it("noCache skips the cache read, omits If-None-Match, and never writes the cache", async () => {
    issuesGet.mockResolvedValueOnce(issuePayload(42)); // seed
    await fetchIssue(42);

    // A noCache read: fresh payload, no conditional header, no cache write.
    issuesGet.mockResolvedValueOnce(
      issuePayload(42, { title: "fresh-uncached" }),
    );
    const fresh = await fetchIssue(42, { noCache: true });

    expect(fresh?.title).toBe("fresh-uncached");
    expect(issuesGet).toHaveBeenCalledTimes(2);
    expect(issuesGet.mock.calls[1][0].headers).toBeUndefined();

    // The noCache call must not have overwritten the cache: a normal read
    // still serves the original cached value with no further GitHub call.
    const cached = await fetchIssue(42);
    expect(cached?.title).toBe("issue-42");
    expect(issuesGet).toHaveBeenCalledTimes(2);
  });
});

describe("invalidateIssueCache", () => {
  it("clears the single issue and every listing when given a number", async () => {
    issuesGet.mockResolvedValueOnce(issuePayload(7));
    listForRepo.mockResolvedValueOnce(listPayload([7]));

    await fetchIssue(7); // seeds issue:acme:widgets:7
    await fetchIssues(); // seeds issues:acme:widgets:{}
    expect(getCacheStats().size).toBe(2);

    invalidateIssueCache(7);
    expect(getCacheStats().size).toBe(0);
  });

  it("clears only listings when called with no argument", async () => {
    issuesGet.mockResolvedValueOnce(issuePayload(7));
    listForRepo.mockResolvedValueOnce(listPayload([7]));

    await fetchIssue(7);
    await fetchIssues();

    invalidateIssueCache(); // listings only
    const keys = getCacheStats().keys;
    expect(keys.some((k) => k.startsWith("issues:"))).toBe(false);
    expect(keys.some((k) => k.startsWith("issue:"))).toBe(true);
  });
});
