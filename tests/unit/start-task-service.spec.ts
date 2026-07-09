import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const reposGet = vi.fn(async () => ({ data: { default_branch: "dev" } }));
  const createWorkflowDispatch = vi.fn(async () => undefined);
  const makeOctokit = (token: string) => ({
    token,
    rest: {
      repos: { get: reposGet },
      actions: { createWorkflowDispatch },
    },
  });

  return {
    resolveBackgroundToken: vi.fn(),
    createUserOctokit: vi.fn(makeOctokit),
    getOctokit: vi.fn(() => makeOctokit("env")),
    getOwner: vi.fn(() => "owner"),
    getRepo: vi.fn(() => "repo"),
    getStoreRepoUrl: vi.fn(() => "https://github.com/owner/store"),
    getStoreRef: vi.fn(() => "main"),
    ensureLabel: vi.fn(async () => undefined),
    addLabels: vi.fn(async () => undefined),
    invalidateTaskCache: vi.fn(),
    reposGet,
    createWorkflowDispatch,
  };
});

vi.spyOn(console, "warn").mockImplementation(() => {});

vi.mock("@dashboard/lib/auth/background-token", () => ({
  resolveBackgroundToken: (
    ...args: Parameters<typeof mocks.resolveBackgroundToken>
  ) => mocks.resolveBackgroundToken(...args),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: (...args: Parameters<typeof mocks.createUserOctokit>) =>
    mocks.createUserOctokit(...args),
  getOctokit: (...args: Parameters<typeof mocks.getOctokit>) =>
    mocks.getOctokit(...args),
  getOwner: (...args: Parameters<typeof mocks.getOwner>) =>
    mocks.getOwner(...args),
  getRepo: (...args: Parameters<typeof mocks.getRepo>) =>
    mocks.getRepo(...args),
  getStoreRepoUrl: (...args: Parameters<typeof mocks.getStoreRepoUrl>) =>
    mocks.getStoreRepoUrl(...args),
  getStoreRef: (...args: Parameters<typeof mocks.getStoreRef>) =>
    mocks.getStoreRef(...args),
  ensureLabel: (...args: Parameters<typeof mocks.ensureLabel>) =>
    mocks.ensureLabel(...args),
  addLabels: (...args: Parameters<typeof mocks.addLabels>) =>
    mocks.addLabels(...args),
  invalidateTaskCache: (
    ...args: Parameters<typeof mocks.invalidateTaskCache>
  ) => mocks.invalidateTaskCache(...args),
}));

import { startKodyTask } from "@dashboard/lib/tasks/start-task";

describe("startKodyTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveBackgroundToken.mockResolvedValue({
      token: "app-token",
      source: "app",
    });
  });

  it("dispatches the workflow with automation credentials", async () => {
    const result = await startKodyTask("issue-42", "tester");

    expect(result).toMatchObject({
      success: true,
      issueNumber: 42,
      workflowDispatched: true,
      backlogLabelApplied: true,
      tokenSource: "app",
      workflowId: "kody.yml",
      ref: "dev",
    });
    expect(mocks.resolveBackgroundToken).toHaveBeenCalledWith("owner", "repo");
    expect(mocks.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      workflow_id: "kody.yml",
      ref: "dev",
      inputs: {
        implementation: "run",
        issue_number: "42",
        storeRepoUrl: "https://github.com/owner/store",
        storeRef: "main",
      },
    });
    expect(mocks.invalidateTaskCache).toHaveBeenCalled();
  });

  it("does not let backlog label failure block the workflow dispatch", async () => {
    mocks.addLabels.mockRejectedValueOnce(new Error("label failed"));

    const result = await startKodyTask("issue-42", "tester");

    expect(result.backlogLabelApplied).toBe(false);
    expect(mocks.createWorkflowDispatch).toHaveBeenCalled();
  });

  it("falls back to the legacy env token only when no background token exists", async () => {
    mocks.resolveBackgroundToken.mockResolvedValueOnce(null);

    const result = await startKodyTask("issue-42", "tester");

    expect(result.tokenSource).toBe("env");
    expect(mocks.getOctokit).toHaveBeenCalled();
    expect(mocks.createWorkflowDispatch).toHaveBeenCalled();
  });
});
