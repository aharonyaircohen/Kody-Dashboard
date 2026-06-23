/**
 * @fileoverview Integration tests for the task add-label action.
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const userOctokit = { kind: "user-octokit" };
  return {
    userOctokit,
    getUserOctokit: vi.fn(),
    ensureLabel: vi.fn(),
    addLabels: vi.fn(),
  };
});

vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => ({ ok: true })),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "tester" } })),
  getUserOctokit: mocks.getUserOctokit,
  getRequestAuth: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@dashboard/lib/branches", () => ({
  isProtectedBranch: vi.fn(() => false),
}));

vi.mock("@dashboard/lib/workflow-matching", () => ({
  matchWorkflowRunsForTask: vi.fn(() => []),
}));

vi.mock("@dashboard/lib/kody-command", () => ({
  withActor: vi.fn((body: string) => body),
  postWithFallback: vi.fn(async () => undefined),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  postComment: vi.fn(async () => undefined),
  triggerWorkflow: vi.fn(async () => undefined),
  cancelWorkflowRun: vi.fn(async () => undefined),
  fetchComments: vi.fn(async () => []),
  fetchIssue: vi.fn(async () => null),
  fetchWorkflowRuns: vi.fn(async () => []),
  updateIssue: vi.fn(async () => undefined),
  addAssignees: vi.fn(async () => undefined),
  removeAssignees: vi.fn(async () => undefined),
  addLabels: (...args: unknown[]) => mocks.addLabels(...args),
  removeLabel: vi.fn(async () => undefined),
  ensureLabel: (...args: unknown[]) => mocks.ensureLabel(...args),
  closePR: vi.fn(async () => undefined),
  findAssociatedPRByIssueNumber: vi.fn(async () => null),
  findTaskBranch: vi.fn(async () => null),
  deleteBranch: vi.fn(async () => undefined),
  invalidateTaskCache: vi.fn(),
  invalidatePRCache: vi.fn(),
  invalidateBoardCache: vi.fn(),
  invalidateBranchCache: vi.fn(),
  getOctokit: vi.fn(() => ({})),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
}));

import { POST } from "../../app/api/kody/tasks/[taskId]/actions/route";

function makeReq(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const params = Promise.resolve({ taskId: "issue-42" });

describe("task add-label action", () => {
  beforeEach(() => {
    mocks.getUserOctokit.mockResolvedValue(mocks.userOctokit);
    mocks.ensureLabel.mockResolvedValue(undefined);
    mocks.addLabels.mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  it("falls back to the bot for dashboard-managed kody labels", async () => {
    mocks.ensureLabel.mockImplementation(
      async (_label: string, _options: unknown, octokit?: unknown) => {
        if (octokit) {
          throw Object.assign(new Error("Resource not accessible"), {
            status: 403,
          });
        }
      },
    );
    mocks.addLabels.mockImplementation(
      async (_issueNumber: number, _labels: string[], octokit?: unknown) => {
        if (octokit) {
          throw Object.assign(new Error("Validation Failed"), { status: 422 });
        }
      },
    );

    const res = await POST(
      makeReq({
        action: "add-label",
        label: "kody:backlog",
        actorLogin: "tester",
      }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mocks.ensureLabel).toHaveBeenNthCalledWith(
      1,
      "kody:backlog",
      expect.objectContaining({ color: "38bdf8" }),
      mocks.userOctokit,
    );
    expect(mocks.ensureLabel).toHaveBeenNthCalledWith(
      2,
      "kody:backlog",
      expect.objectContaining({ color: "38bdf8" }),
    );
    expect(mocks.addLabels).toHaveBeenNthCalledWith(
      1,
      42,
      ["kody:backlog"],
      mocks.userOctokit,
    );
    expect(mocks.addLabels).toHaveBeenNthCalledWith(2, 42, ["kody:backlog"]);
  });

  it("does not fall back for ordinary labels", async () => {
    mocks.addLabels.mockRejectedValue(
      Object.assign(new Error("Resource not accessible"), { status: 403 }),
    );

    const res = await POST(
      makeReq({
        action: "add-label",
        label: "bug",
        actorLogin: "tester",
      }),
      { params },
    );

    expect(res.status).toBe(403);
    expect(mocks.ensureLabel).not.toHaveBeenCalled();
    expect(mocks.addLabels).toHaveBeenCalledTimes(1);
    expect(mocks.addLabels).toHaveBeenCalledWith(
      42,
      ["bug"],
      mocks.userOctokit,
    );
  });
});
