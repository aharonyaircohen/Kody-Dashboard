/**
 * @fileoverview Integration test for the `close-pr` task action.
 * @testFramework vitest
 * @domain kody
 *
 * The dashboard's "Close PR" button (task details page + Preview action
 * bar) must close the PR AND delete its head branch — GitHub has no
 * "delete PR", so close + delete-branch is the closest thing. This test
 * pins that behavior so a future refactor can't silently revert it to
 * "close only" (the old behavior whose confirm dialog said "This will
 * NOT delete the branch").
 *
 * Protected branches (e.g. main/dev) must never be deleted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks for every module the route pulls in at import time ----------

const closePR = vi.fn(async () => undefined);
const deleteBranch = vi.fn(async () => undefined);
const findAssociatedPRByIssueNumber = vi.fn();
const findTaskBranch = vi.fn();
const isProtectedBranch = vi.fn();

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => ({ ok: true })),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "tester" } })),
  getUserOctokit: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@dashboard/lib/branches", () => ({
  isProtectedBranch: (b: string) => isProtectedBranch(b),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  postComment: vi.fn(async () => undefined),
  triggerWorkflow: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  fetchComments: vi.fn(async () => []),
  fetchIssue: vi.fn(async () => null),
  fetchWorkflowRuns: vi.fn(async () => []),
  updateIssue: vi.fn(async () => undefined),
  addAssignees: vi.fn(),
  removeAssignees: vi.fn(),
  addLabels: vi.fn(),
  removeLabel: vi.fn(),
  ensureLabel: vi.fn(),
  closePR: (...a: unknown[]) => closePR(...a),
  findAssociatedPRByIssueNumber: (...a: unknown[]) =>
    findAssociatedPRByIssueNumber(...a),
  findTaskBranch: (...a: unknown[]) => findTaskBranch(...a),
  deleteBranch: (...a: unknown[]) => deleteBranch(...a),
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

function makeReq(action: string) {
  return {
    json: async () => ({ action, actorLogin: "tester" }),
  } as unknown as Parameters<typeof POST>[0];
}

const params = Promise.resolve({ taskId: "issue-42" });

describe("close-pr task action", () => {
  beforeEach(() => {
    closePR.mockClear();
    deleteBranch.mockClear();
    findAssociatedPRByIssueNumber.mockReset();
    findTaskBranch.mockReset();
    isProtectedBranch.mockReset();
  });

  it("closes the PR AND deletes the branch", async () => {
    findAssociatedPRByIssueNumber.mockResolvedValue({ number: 7 });
    findTaskBranch.mockResolvedValue("kody/issue-42");
    isProtectedBranch.mockReturnValue(false);

    const res = await POST(makeReq("close-pr"), { params });
    const json = await res.json();

    expect(closePR).toHaveBeenCalledWith(7, undefined);
    expect(deleteBranch).toHaveBeenCalledWith("kody/issue-42", undefined);
    expect(json.message).toBe("PR #7 closed and branch deleted");
  });

  it("closes the PR but never deletes a protected branch", async () => {
    findAssociatedPRByIssueNumber.mockResolvedValue({ number: 7 });
    findTaskBranch.mockResolvedValue("main");
    isProtectedBranch.mockReturnValue(true);

    const res = await POST(makeReq("close-pr"), { params });
    const json = await res.json();

    expect(closePR).toHaveBeenCalledWith(7, undefined);
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(json.message).toBe("PR #7 closed");
  });

  it("404s when there is no associated PR", async () => {
    findAssociatedPRByIssueNumber.mockResolvedValue(null);

    const res = await POST(makeReq("close-pr"), { params });

    expect(res.status).toBe(404);
    expect(closePR).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
  });
});
