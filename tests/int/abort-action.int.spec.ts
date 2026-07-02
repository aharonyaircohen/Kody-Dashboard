/**
 * @fileoverview Integration tests for the task abort action.
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postWithFallback: vi.fn(async () => undefined),
  cancelWorkflowRun: vi.fn(async () => undefined),
  fetchIssue: vi.fn(async () => ({
    title: "Show Google login popup after onboarding wizard completes",
  })),
  fetchWorkflowRuns: vi.fn(async () => [
    {
      id: 123,
      status: "in_progress",
      conclusion: null,
      created_at: "2026-07-01T16:00:00Z",
      updated_at: "2026-07-01T16:00:00Z",
      html_url: "https://github.test/run/123",
      display_title:
        "Show Google login popup after onboarding wizard completes",
    },
  ]),
  fetchComments: vi.fn(async () => []),
  removeLabel: vi.fn(async () => undefined),
  getWorkflowRun: vi.fn(async () => ({
    data: {
      status: "in_progress",
    },
  })),
  matchWorkflowRunsForTask: vi.fn((runs: unknown[]) => runs),
  invalidateTaskCache: vi.fn(),
  invalidateBoardCache: vi.fn(),
}));

vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

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
  isProtectedBranch: vi.fn(() => false),
}));

vi.mock("@dashboard/lib/workflow-matching", () => ({
  matchWorkflowRunsForTask: (
    ...args: Parameters<typeof mocks.matchWorkflowRunsForTask>
  ) => mocks.matchWorkflowRunsForTask(...args),
}));

vi.mock("@dashboard/lib/kody-command", () => ({
  withActor: vi.fn((body: string) => body),
  postWithFallback: (...args: Parameters<typeof mocks.postWithFallback>) =>
    mocks.postWithFallback(...args),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  postComment: vi.fn(async () => undefined),
  triggerWorkflow: vi.fn(async () => undefined),
  cancelWorkflowRun: (...args: Parameters<typeof mocks.cancelWorkflowRun>) =>
    mocks.cancelWorkflowRun(...args),
  fetchComments: (...args: Parameters<typeof mocks.fetchComments>) =>
    mocks.fetchComments(...args),
  fetchIssue: (...args: Parameters<typeof mocks.fetchIssue>) =>
    mocks.fetchIssue(...args),
  fetchWorkflowRuns: (...args: Parameters<typeof mocks.fetchWorkflowRuns>) =>
    mocks.fetchWorkflowRuns(...args),
  updateIssue: vi.fn(async () => undefined),
  addAssignees: vi.fn(async () => undefined),
  removeAssignees: vi.fn(async () => undefined),
  addLabels: vi.fn(async () => undefined),
  removeLabel: (...args: Parameters<typeof mocks.removeLabel>) =>
    mocks.removeLabel(...args),
  ensureLabel: vi.fn(async () => undefined),
  closePR: vi.fn(async () => undefined),
  findAssociatedPRByIssueNumber: vi.fn(async () => null),
  findTaskBranch: vi.fn(async () => null),
  deleteBranch: vi.fn(async () => undefined),
  invalidateTaskCache: (
    ...args: Parameters<typeof mocks.invalidateTaskCache>
  ) => mocks.invalidateTaskCache(...args),
  invalidatePRCache: vi.fn(),
  invalidateBoardCache: (
    ...args: Parameters<typeof mocks.invalidateBoardCache>
  ) => mocks.invalidateBoardCache(...args),
  invalidateBranchCache: vi.fn(),
  getOctokit: vi.fn(() => ({
    actions: {
      getWorkflowRun: (...args: Parameters<typeof mocks.getWorkflowRun>) =>
        mocks.getWorkflowRun(...args),
    },
  })),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
}));

import { POST } from "../../app/api/kody/tasks/[taskId]/actions/route";

function makeReq(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const params = Promise.resolve({ taskId: "issue-674" });

describe("task actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reruns by posting the normal Kody issue command instead of invalid workflow inputs", async () => {
    const res = await POST(makeReq({ action: "rerun", actorLogin: "tester" }), {
      params,
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBe("Kody rerun triggered");
    expect(mocks.postWithFallback).toHaveBeenCalledWith(
      674,
      "@kody",
      "tester",
      null,
    );
  });

  it("cancels matching workflow runs without posting a comment that retriggers Kody", async () => {
    const res = await POST(makeReq({ action: "abort", actorLogin: "tester" }), {
      params,
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBe("Stop requested for 1 workflow run");
    expect(mocks.cancelWorkflowRun).toHaveBeenCalledWith(123, undefined);
    expect(mocks.removeLabel).not.toHaveBeenCalled();
    expect(mocks.postWithFallback).not.toHaveBeenCalled();
    expect(mocks.invalidateTaskCache).toHaveBeenCalled();
    expect(mocks.invalidateBoardCache).toHaveBeenCalled();
  });

  it("clears stale lifecycle labels when no live workflow run is found", async () => {
    mocks.fetchWorkflowRuns.mockResolvedValueOnce([]);
    mocks.matchWorkflowRunsForTask.mockReturnValueOnce([]);

    const res = await POST(makeReq({ action: "abort", actorLogin: "tester" }), {
      params,
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBe(
      "Cleared stale running labels (no live workflow run found)",
    );
    expect(mocks.removeLabel).toHaveBeenCalledWith(
      674,
      "kody:running",
      undefined,
    );
  });
});
