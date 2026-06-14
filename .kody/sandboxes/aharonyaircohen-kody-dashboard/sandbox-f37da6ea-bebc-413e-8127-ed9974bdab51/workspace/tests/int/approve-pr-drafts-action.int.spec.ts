/**
 * Integration test for the `approve-pr` task action's draft handling
 * (issue #129). Before the fix, `octokit.pulls.createReview({event:
 * "APPROVE"})` was called unconditionally and GitHub rejected it on
 * draft PRs — the `try/catch` swallowed the error and the UI
 * optimistically flipped to "Approved" while the GitHub review never
 * landed.
 *
 * The fix adds an optional `approveDrafts: boolean` body field:
 *   - When `true` and the PR is a draft, the handler must call
 *     `octokit.pulls.update({ draft: false })` BEFORE the createReview.
 *   - When `false`/omitted, the handler must not touch the draft flag
 *     (preserves byte-identical behavior for non-draft PRs and for
 *     existing clients that don't opt in).
 *
 * The test mocks the Octokit client (PR review + PR update + label
 * add) and asserts the call order + arity. The route's other
 * side-effects (label add + audit + cache invalidate) are pinned at
 * a coarse level so a refactor that drops them still fails.
 *
 * @testFramework vitest
 * @domain kody
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks for every module the route pulls in at import time ----

const pullsCreateReview = vi.fn(async () => ({}));
const pullsUpdate = vi.fn(async () => ({}));
const findAssociatedPRByIssueNumber = vi.fn();
const addLabels = vi.fn(async () => undefined);
const postWithFallback = vi.fn(async () => undefined);

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => ({ ok: true })),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "tester" } })),
  getUserOctokit: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@dashboard/lib/kody-command", () => ({
  withActor: (msg: string) => msg,
  postWithFallback: (...a: Parameters<typeof postWithFallback>) =>
    postWithFallback(...a),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  postComment: vi.fn(),
  triggerWorkflow: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  fetchComments: vi.fn(async () => []),
  fetchIssue: vi.fn(async () => null),
  fetchWorkflowRuns: vi.fn(async () => []),
  updateIssue: vi.fn(),
  addAssignees: vi.fn(),
  removeAssignees: vi.fn(),
  addLabels: (...a: Parameters<typeof addLabels>) => addLabels(...a),
  removeLabel: vi.fn(),
  ensureLabel: vi.fn(),
  closePR: vi.fn(),
  findAssociatedPRByIssueNumber: (
    ...a: Parameters<typeof findAssociatedPRByIssueNumber>
  ) => findAssociatedPRByIssueNumber(...a),
  findTaskBranch: vi.fn(),
  deleteBranch: vi.fn(),
  invalidateTaskCache: vi.fn(),
  invalidatePRCache: vi.fn(),
  invalidateBoardCache: vi.fn(),
  invalidateBranchCache: vi.fn(),
  getOctokit: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
}));

// Imported after the mocks so the route binds to them.
import { POST } from "../../app/api/kody/tasks/[taskId]/actions/route";

function makeReq(body: Record<string, unknown>) {
  return {
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

const params = Promise.resolve({ taskId: "issue-42" });

function userOctokit() {
  return {
    pulls: {
      createReview: pullsCreateReview,
      update: pullsUpdate,
    },
  } as unknown as Parameters<typeof POST>[0] extends never ? never : any;
}

describe("approve-pr task action — 'Also approve drafts' toggle (issue #129)", () => {
  beforeEach(() => {
    pullsCreateReview.mockClear();
    pullsUpdate.mockClear();
    findAssociatedPRByIssueNumber.mockReset();
    addLabels.mockClear();
    postWithFallback.mockClear();
  });

  it("marks the PR ready-for-review BEFORE createReview when approveDrafts=true and the PR is a draft", async () => {
    findAssociatedPRByIssueNumber.mockResolvedValue({
      number: 7,
      isDraft: true,
    });
    // Wire the userOctokit (the route picks it via getUserOctokit).
    const auth = await import("@dashboard/lib/auth");
    vi.mocked(auth.getUserOctokit).mockResolvedValue(userOctokit());

    const res = await POST(
      makeReq({
        action: "approve-pr",
        actorLogin: "tester",
        approveDrafts: true,
      }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // The ready-for-review call must have happened first.
    expect(pullsUpdate).toHaveBeenCalledTimes(1);
    expect(pullsUpdate).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 7,
      draft: false,
    });

    // And the review must have happened after, in the same handler.
    expect(pullsCreateReview).toHaveBeenCalledTimes(1);
    expect(pullsCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        pull_number: 7,
        event: "APPROVE",
      }),
    );

    // update is called strictly before createReview — pin the order so a
    // future refactor can't accidentally re-order and post a review on
    // a still-draft PR.
    const updateOrder = pullsUpdate.mock.invocationCallOrder[0]!;
    const reviewOrder = pullsCreateReview.mock.invocationCallOrder[0]!;
    expect(updateOrder).toBeLessThan(reviewOrder);
  });

  it("does NOT touch the draft flag when approveDrafts is omitted (legacy clients)", async () => {
    findAssociatedPRByIssueNumber.mockResolvedValue({
      number: 7,
      isDraft: true,
    });
    const auth = await import("@dashboard/lib/auth");
    vi.mocked(auth.getUserOctokit).mockResolvedValue(userOctokit());

    const res = await POST(
      makeReq({ action: "approve-pr", actorLogin: "tester" }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(pullsUpdate).not.toHaveBeenCalled();
    // The review is still attempted (and silently swallowed if the PR is
    // a draft — same as today), so the call count is unchanged.
    expect(pullsCreateReview).toHaveBeenCalledTimes(1);
  });

  it("does NOT touch the draft flag when the PR is not a draft, even with approveDrafts=true", async () => {
    findAssociatedPRByIssueNumber.mockResolvedValue({
      number: 7,
      isDraft: false,
    });
    const auth = await import("@dashboard/lib/auth");
    vi.mocked(auth.getUserOctokit).mockResolvedValue(userOctokit());

    const res = await POST(
      makeReq({
        action: "approve-pr",
        actorLogin: "tester",
        approveDrafts: true,
      }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(pullsUpdate).not.toHaveBeenCalled();
    expect(pullsCreateReview).toHaveBeenCalledTimes(1);
  });
});
