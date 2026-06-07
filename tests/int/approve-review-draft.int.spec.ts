/**
 * @fileoverview Integration test for the `approve-review` task action's
 * new "mark draft PRs ready-for-review" step (#112).
 * @testFramework vitest
 * @domain kody
 *
 * GitHub refuses to merge draft PRs (409 "not mergeable"). The handler
 * must flip `draft: false` between posting the APPROVE review and
 * calling `pulls.merge`, so draft PRs can be approved-and-merged
 * end-to-end. Non-draft PRs must not pay an extra API call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks for every module the route pulls in at import time ----------
// vi.mock factories are hoisted, so the handle must live in vi.hoisted
// (or be a literal object — see secrets-route.int.spec.ts for the same
// pattern).

const pullsGet = vi.hoisted(() => vi.fn());
const pullsCreateReview = vi.hoisted(() => vi.fn());
const pullsUpdate = vi.hoisted(() => vi.fn());
const pullsMerge = vi.hoisted(() => vi.fn());
const gitDeleteRef = vi.hoisted(() => vi.fn());
const updateIssue = vi.hoisted(() => vi.fn());
const invalidateIssueCache = vi.hoisted(() => vi.fn());
const invalidateTaskCache = vi.hoisted(() => vi.fn());
const setGitHubContext = vi.hoisted(() => vi.fn());
const clearGitHubContext = vi.hoisted(() => vi.fn());

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "tester" } })),
  getUserOctokit: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/auth", () => auth);

vi.mock("@dashboard/lib/branches", () => ({
  isProtectedBranch: (b: string) => b === "dev" || b === "main",
}));

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: vi.fn(() => ({
    pulls: {
      get: (...a: unknown[]) => pullsGet(...a),
      createReview: (...a: unknown[]) => pullsCreateReview(...a),
      update: (...a: unknown[]) => pullsUpdate(...a),
      merge: (...a: unknown[]) => pullsMerge(...a),
    },
    git: { deleteRef: (...a: unknown[]) => gitDeleteRef(...a) },
  })),
  setGitHubContext: (...a: unknown[]) => setGitHubContext(...a),
  clearGitHubContext: (...a: unknown[]) => clearGitHubContext(...a),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
  updateIssue: (...a: unknown[]) => updateIssue(...a),
  invalidateIssueCache: (...a: unknown[]) => invalidateIssueCache(...a),
  invalidateTaskCache: (...a: unknown[]) => invalidateTaskCache(...a),
}));

// Imported after the mocks so the route binds to them.
import { POST } from "../../app/api/kody/tasks/approve-review/route";
import { NextRequest } from "next/server";

function makeReq(body: unknown) {
  return new NextRequest("https://dash.test/api/kody/tasks/approve-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("approve-review: draft PR handling", () => {
  beforeEach(() => {
    pullsGet.mockReset();
    pullsCreateReview.mockReset();
    pullsUpdate.mockReset();
    pullsMerge.mockReset();
    gitDeleteRef.mockReset();
    updateIssue.mockReset();
    invalidateIssueCache.mockReset();
    invalidateTaskCache.mockReset();

    // Default: review + merge succeed
    pullsCreateReview.mockResolvedValue({});
    pullsUpdate.mockResolvedValue({});
    pullsMerge.mockResolvedValue({});
  });

  it("flips a draft PR to ready-for-review, then merges it", async () => {
    pullsGet.mockResolvedValue({
      data: {
        head: { ref: "feature/x" },
        base: { ref: "main" },
        draft: true,
      },
    });

    const res = await POST(
      makeReq({ prNumber: 7, actorLogin: "tester", issueNumber: 42 }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(pullsUpdate).toHaveBeenCalledTimes(1);
    expect(pullsUpdate).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 7,
      draft: false,
    });
    // Order: review post → ready-for-review update → merge
    const updateOrder = pullsUpdate.mock.invocationCallOrder[0];
    const mergeOrder = pullsMerge.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(mergeOrder);

    // Branch cleanup still runs for non-publish PRs
    expect(gitDeleteRef).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      ref: "heads/feature/x",
    });
    // Task close still runs
    expect(updateIssue).toHaveBeenCalledWith(
      42,
      { state: "closed" },
      undefined,
    );

    // And the user-visible result mentions both steps
    const text = json.results.join(" | ");
    expect(text).toMatch(/Marked PR #7 ready for review/);
    expect(text).toMatch(/Merged PR #7/);
  });

  it("does NOT call pulls.update for an already-ready PR (no extra API call)", async () => {
    pullsGet.mockResolvedValue({
      data: {
        head: { ref: "feature/y" },
        base: { ref: "main" },
        draft: false,
      },
    });

    const res = await POST(makeReq({ prNumber: 9, actorLogin: "tester" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(pullsUpdate).not.toHaveBeenCalled();
    // Merge still ran
    expect(pullsMerge).toHaveBeenCalledTimes(1);
    // And the result log does not mention the new step
    const text = json.results.join(" | ");
    expect(text).not.toMatch(/ready for review/i);
    expect(text).toMatch(/Approved PR #9/);
    expect(text).toMatch(/Merged PR #9/);
  });

  it("treats a missing `draft` field as not-a-draft (defensive — older payloads)", async () => {
    pullsGet.mockResolvedValue({
      data: {
        head: { ref: "feature/z" },
        base: { ref: "main" },
        // no `draft` field at all
      },
    });

    const res = await POST(makeReq({ prNumber: 11, actorLogin: "tester" }));

    expect(res.status).toBe(200);
    expect(pullsUpdate).not.toHaveBeenCalled();
    expect(pullsMerge).toHaveBeenCalledTimes(1);
  });

  it("records a soft note but still attempts the merge if the ready-for-review call fails", async () => {
    pullsGet.mockResolvedValue({
      data: {
        head: { ref: "feature/w" },
        base: { ref: "main" },
        draft: true,
      },
    });
    pullsUpdate.mockRejectedValueOnce(new Error("403 forbidden"));

    const res = await POST(makeReq({ prNumber: 13, actorLogin: "tester" }));
    const json = await res.json();

    // The error is captured as a soft note (mirrors the review-post error
    // handling) — the merge attempt is NOT aborted.
    expect(res.status).toBe(200);
    expect(pullsUpdate).toHaveBeenCalledTimes(1);
    expect(pullsMerge).toHaveBeenCalledTimes(1);
    const text = json.results.join(" | ");
    expect(text).toMatch(/Ready-for-review note: 403 forbidden/);
    expect(text).toMatch(/Merged PR #13/);
  });
});
