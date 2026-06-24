/**
 * Unit tests for github-client's GraphQL-backed read paths and their
 * rate-limit safeguards (src/dashboard/lib/github-client.ts):
 *
 *   - `fetchOpenPRs`: in-flight dedup so concurrent polls collapse to one
 *     GraphQL call, a warm-cache hit makes zero calls, and a GraphQL error
 *     with stale data in cache returns the stale payload AND refreshes the
 *     TTL (so throttling doesn't compound into a poll storm) instead of
 *     throwing.
 *   - `fetchIssues` REST→GraphQL fallback: when the REST listing comes back
 *     empty (a real GitHub outage mode), it retries once via GraphQL.
 *   - `invalidatePRCache` clears the PR listing.
 *
 * GraphQL has its own 5000-points/hr bucket and no ETag/304 escape hatch,
 * so these fallbacks are exactly the "don't compound throttling" rules in
 * CLAUDE.md. Octokit is mocked at the `@octokit/rest` boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { issuesGet, listForRepo, graphql } = vi.hoisted(() => ({
  issuesGet: vi.fn(),
  listForRepo: vi.fn(),
  graphql: vi.fn(),
}));

vi.mock("@octokit/plugin-throttling", () => ({ throttling: () => ({}) }));
vi.mock("@octokit/rest", () => {
  class FakeOctokit {
    issues = { get: issuesGet, listForRepo: listForRepo };
    graphql = graphql;
    static plugin() {
      return FakeOctokit;
    }
  }
  return { Octokit: FakeOctokit };
});

import {
  fetchOpenPRs,
  fetchIssues,
  findAssociatedPRByIssueNumber,
  invalidatePRCache,
  setGitHubContext,
  clearGitHubContext,
  clearCache,
  getCacheStats,
} from "@dashboard/lib/github-client";

function prNode(number: number) {
  return {
    databaseId: number * 10,
    number,
    title: `pr-${number}`,
    state: "OPEN",
    url: `https://github.com/acme/widgets/pull/${number}`,
    mergedAt: null,
    headRefName: `${number}-feature`,
    headRefOid: "headsha",
    baseRefName: "main",
    body: null,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    labels: { nodes: [{ name: "kody:task" }] },
    isDraft: false,
    closingIssuesReferences: { nodes: [{ number }] },
    commits: {
      nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }],
    },
  };
}

// Variant factory: same as prNode but with custom mergeStateStatus / rollup
// state / mergeable. Used to exercise the derivePRCi mapping per branch.
function prNodeWith(
  number: number,
  opts: {
    mergeStateStatus?: string;
    mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    rollupState?: string | null;
  },
) {
  return {
    ...prNode(number),
    mergeable: opts.mergeable ?? "MERGEABLE",
    mergeStateStatus: opts.mergeStateStatus ?? "CLEAN",
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup:
              opts.rollupState === null
                ? null
                : { state: opts.rollupState ?? "SUCCESS" },
          },
        },
      ],
    },
  };
}

const openPRsResponse = (numbers: number[]) => ({
  repository: { pullRequests: { nodes: numbers.map(prNode) } },
});

function gqlIssueNode(number: number) {
  return {
    databaseId: number * 100,
    number,
    title: `gql-issue-${number}`,
    body: "body",
    state: "OPEN",
    url: `https://github.com/acme/widgets/issues/${number}`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    closedAt: null,
    labels: { nodes: [] },
    milestone: null,
    assignees: { nodes: [] },
  };
}

const gqlIssuesResponse = (numbers: number[]) => ({
  repository: { issues: { nodes: numbers.map(gqlIssueNode) } },
});

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

describe("fetchOpenPRs", () => {
  it("maps GraphQL PR nodes into the dashboard shape", async () => {
    graphql.mockResolvedValueOnce(openPRsResponse([12]));

    const prs = await fetchOpenPRs();

    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 12,
      title: "pr-12",
      head: { ref: "12-feature" },
      base: { ref: "main" },
      labels: ["kody:task"],
      closingIssueNumbers: [12],
    });
    expect(prs[0].ciStatus).toBeDefined();
  });

  it("serves a warm cache hit without a second GraphQL call", async () => {
    graphql.mockResolvedValueOnce(openPRsResponse([1]));

    await fetchOpenPRs();
    await fetchOpenPRs();

    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("matches an issue that is itself an open PR by number", async () => {
    graphql.mockResolvedValueOnce(openPRsResponse([350]));

    const pr = await findAssociatedPRByIssueNumber(350);

    expect(pr).toMatchObject({
      number: 350,
      head: { ref: "350-feature" },
      html_url: "https://github.com/acme/widgets/pull/350",
    });
    expect(issuesGet).not.toHaveBeenCalled();
  });

  it("collapses concurrent polls into one GraphQL call (in-flight dedup)", async () => {
    graphql.mockResolvedValueOnce(openPRsResponse([1, 2]));

    // Fire two reads synchronously — the second must reuse the in-flight promise.
    const [a, b] = await Promise.all([fetchOpenPRs(), fetchOpenPRs()]);

    expect(graphql).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("returns stale data and refreshes the TTL when GraphQL errors", async () => {
    vi.useFakeTimers();
    graphql.mockResolvedValueOnce(openPRsResponse([7]));
    const fresh = await fetchOpenPRs(); // seed cache

    // Expire the cache, then fail the next GraphQL call.
    vi.advanceTimersByTime(10 * 60_000);
    graphql.mockRejectedValueOnce(new Error("GraphQL throttled"));

    const stale = await fetchOpenPRs();
    expect(stale).toEqual(fresh); // no throw, served stale

    // TTL was refreshed on the stale data — the next poll is a cache hit and
    // does NOT re-hit GraphQL (the anti-throttle-storm guarantee).
    const third = await fetchOpenPRs();
    expect(third).toEqual(fresh);
    expect(graphql).toHaveBeenCalledTimes(2);
  });

  it("propagates the error when GraphQL fails with no stale fallback", async () => {
    graphql.mockRejectedValueOnce(new Error("cold-start GraphQL failure"));
    await expect(fetchOpenPRs()).rejects.toThrow(/cold-start GraphQL failure/);
  });

  it("invalidatePRCache clears the cached PR listing", async () => {
    graphql.mockResolvedValue(openPRsResponse([1]));
    await fetchOpenPRs();
    expect(getCacheStats().keys.some((k) => k.startsWith("open-prs:"))).toBe(
      true,
    );

    invalidatePRCache();
    expect(getCacheStats().keys.some((k) => k.startsWith("open-prs:"))).toBe(
      false,
    );
  });

  // Regression: DIRTY = merge conflicts, not failing CI. The bug mapped
  // mergeStateStatus=DIRTY → ciStatus="failure", which made every PR with
  // conflicts (or just behind main) show as CI red even when all checks
  // were green. The conflict banner owns that case via hasConflicts.
  describe("derivePRCi: DIRTY (merge conflicts) must not report CI failure", () => {
    it("reports the actual rollup state when DIRTY + checks are SUCCESS", async () => {
      graphql.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              prNodeWith(58, {
                mergeStateStatus: "DIRTY",
                mergeable: "CONFLICTING",
                rollupState: "SUCCESS",
              }),
            ],
          },
        },
      });

      const prs = await fetchOpenPRs();
      expect(prs[0].ciStatus).toBe("success");
      expect(prs[0].hasConflicts).toBe(true);
      expect(prs[0].mergeable).toBe(false);
    });

    it("reports running when DIRTY + checks are PENDING", async () => {
      graphql.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              prNodeWith(40, {
                mergeStateStatus: "DIRTY",
                mergeable: "CONFLICTING",
                rollupState: "PENDING",
              }),
            ],
          },
        },
      });

      const prs = await fetchOpenPRs();
      expect(prs[0].ciStatus).toBe("running");
      expect(prs[0].hasConflicts).toBe(true);
      expect(prs[0].mergeable).toBe(false);
    });

    it("still reports failure when DIRTY + checks genuinely failed", async () => {
      graphql.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              prNodeWith(7, {
                mergeStateStatus: "DIRTY",
                mergeable: "CONFLICTING",
                rollupState: "FAILURE",
              }),
            ],
          },
        },
      });

      const prs = await fetchOpenPRs();
      // hasConflicts owns the conflict UI; ciStatus still reflects real CI.
      expect(prs[0].ciStatus).toBe("failure");
      expect(prs[0].hasConflicts).toBe(true);
      expect(prs[0].mergeable).toBe(false);
    });

    it("falls back to pending when DIRTY + no rollup state", async () => {
      graphql.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              prNodeWith(11, {
                mergeStateStatus: "DIRTY",
                mergeable: "CONFLICTING",
                rollupState: null,
              }),
            ],
          },
        },
      });

      const prs = await fetchOpenPRs();
      expect(prs[0].ciStatus).toBe("pending");
      expect(prs[0].hasConflicts).toBe(true);
      expect(prs[0].mergeable).toBe(false);
    });
  });
});

describe("fetchIssues REST→GraphQL fallback", () => {
  it("retries via GraphQL when the REST listing is empty", async () => {
    listForRepo.mockResolvedValueOnce({ data: [], headers: {} });
    graphql.mockResolvedValueOnce(gqlIssuesResponse([55]));

    const issues = await fetchIssues();

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      number: 55,
      title: "gql-issue-55",
      state: "open",
    });
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("does not call GraphQL when the REST listing is non-empty", async () => {
    listForRepo.mockResolvedValueOnce({
      data: [
        {
          id: 1,
          number: 1,
          title: "rest-issue",
          body: null,
          state: "open",
          labels: [],
          milestone: null,
          assignees: [],
          created_at: "",
          updated_at: "",
          closed_at: null,
          html_url: "",
        },
      ],
      headers: { etag: '"x"' },
    });

    const issues = await fetchIssues();
    expect(issues[0].title).toBe("rest-issue");
    expect(graphql).not.toHaveBeenCalled();
  });
});
