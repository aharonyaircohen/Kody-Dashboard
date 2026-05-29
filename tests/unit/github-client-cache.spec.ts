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
  invalidateDutiesCache,
  invalidateStaffCache,
  invalidateCommandsCache,
  invalidateMemoryCache,
  setCache,
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

describe("invalidateDutiesCache", () => {
  it("clears only the per-item cache when a slug is given", () => {
    // Seed both the per-item cache and the listing cache.
    setCache("duty:acme:widgets:my-slug", 60_000, { title: "duty" });
    setCache("duties:acme:widgets:{}", 60_000, [{ slug: "my-slug" }]);

    invalidateDutiesCache("my-slug");

    // Per-item cache should be gone; listing cache should remain.
    const keys = getCacheStats().keys;
    expect(keys.some((k) => k.startsWith("duty:"))).toBe(false);
    expect(keys.some((k) => k.startsWith("duties:"))).toBe(true);
  });

  it("clears only the listing cache when no slug is given", () => {
    setCache("duty:acme:widgets:my-slug", 60_000, { title: "duty" });
    setCache("duties:acme:widgets:{}", 60_000, [{ slug: "my-slug" }]);

    invalidateDutiesCache();

    // Listing cache should be gone; per-item cache should remain.
    const keys = getCacheStats().keys;
    expect(keys.some((k) => k.startsWith("duty:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("duties:"))).toBe(false);
  });
});

describe("invalidateStaffCache", () => {
  it("clears only the per-item cache when a slug is given", () => {
    setCache("staff:acme:widgets:jane", 60_000, { name: "Jane" });
    setCache("staffs:acme:widgets:{}", 60_000, [{ slug: "jane" }]);

    invalidateStaffCache("jane");

    const keys = getCacheStats().keys;
    expect(keys.some((k) => k.startsWith("staff:"))).toBe(false);
    expect(keys.some((k) => k.startsWith("staffs:"))).toBe(true);
  });

  it("clears only the listing cache when no slug is given", () => {
    setCache("staff:acme:widgets:jane", 60_000, { name: "Jane" });
    setCache("staffs:acme:widgets:{}", 60_000, [{ slug: "jane" }]);

    invalidateStaffCache();

    const keys = getCacheStats().keys;
    expect(keys.some((k) => k.startsWith("staff:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("staffs:"))).toBe(false);
  });
});

describe("invalidateCommandsCache", () => {
  it("clears only the per-item cache when a slug is given", () => {
    setCache("prompt:acme:widgets:my-cmd", 60_000, { prompt: "hello" });
    setCache("prompts:acme:widgets:{}", 60_000, [{ slug: "my-cmd" }]);

    invalidateCommandsCache("my-cmd");

    const keys = getCacheStats().keys;
    expect(keys.some((k) => k.startsWith("prompt:"))).toBe(false);
    expect(keys.some((k) => k.startsWith("prompts:"))).toBe(true);
  });

  it("clears only the listing cache when no slug is given", () => {
    setCache("prompt:acme:widgets:my-cmd", 60_000, { prompt: "hello" });
    setCache("prompts:acme:widgets:{}", 60_000, [{ slug: "my-cmd" }]);

    invalidateCommandsCache();

    const keys = getCacheStats().keys;
    expect(keys.some((k) => k.startsWith("prompt:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("prompts:"))).toBe(false);
  });
});

describe("invalidateMemoryCache", () => {
  it("clears only the per-item cache when an id is given", () => {
    setCache("memory:acme:widgets:mem-1", 60_000, { text: "hello" });
    setCache("memory-index:acme:widgets:{}", 60_000, [{ id: "mem-1" }]);
    setCache("memories:acme:widgets:{}", 60_000, [{ id: "mem-1" }]);

    invalidateMemoryCache("mem-1");

    const keys = getCacheStats().keys;
    expect(
      keys.some((k) => k.startsWith("memory:") && !k.includes("index")),
    ).toBe(false);
    expect(keys.some((k) => k.startsWith("memory-index:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("memories:"))).toBe(true);
  });

  it("clears only the listing cache when no id is given", () => {
    setCache("memory:acme:widgets:mem-1", 60_000, { text: "hello" });
    setCache("memory-index:acme:widgets:{}", 60_000, [{ id: "mem-1" }]);
    setCache("memories:acme:widgets:{}", 60_000, [{ id: "mem-1" }]);

    invalidateMemoryCache();

    const keys = getCacheStats().keys;
    expect(
      keys.some((k) => k.startsWith("memory:") && !k.includes("index")),
    ).toBe(true);
    expect(keys.some((k) => k.startsWith("memory-index:"))).toBe(false);
    expect(keys.some((k) => k.startsWith("memories:"))).toBe(false);
  });
});
