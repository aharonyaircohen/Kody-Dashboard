/**
 * Unit tests for the agentResponsibility run endpoint
 * (app/api/kody/agent-responsibilities/[slug]/run/route.ts).
 *
 * A manual agentResponsibility run is a workflow_dispatch with the agentResponsibility-owned public action.
 * The GitHub Actions input is still named `agentAction` for workflow
 * compatibility, but its value must be `agentResponsibility.action`, not the implementation
 * agentAction.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  getUserOctokit: vi.fn(),
  getRequestAuth: vi.fn(() => ({
    owner: "test-owner",
    repo: "test-repo",
    token: "ghp_test-token",
  })),
}));

vi.mock("@dashboard/lib/agent-responsibilities-files", () => ({
  isValidSlug: vi.fn((slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)),
  readAgentResponsibilityFile: vi.fn(),
  readResolvedAgentResponsibilityFile: vi.fn(),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

const auth = await import("@dashboard/lib/auth");
const agentResponsibilityFiles = await import("@dashboard/lib/agent-responsibilities-files");
const githubClient = await import("@dashboard/lib/github-client");

const getUserOctokit = vi.mocked(auth.getUserOctokit);
const readResolvedAgentResponsibilityFile = vi.mocked(agentResponsibilityFiles.readResolvedAgentResponsibilityFile);
const clearGitHubContext = vi.mocked(githubClient.clearGitHubContext);

import { POST } from "../../app/api/kody/agent-responsibilities/[slug]/run/route";

afterEach(() => {
  vi.clearAllMocks();
});

function makeRunRequest(slug: string) {
  return new NextRequest(`https://dash.test/api/kody/agent-responsibilities/${slug}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "test-owner",
      "x-kody-repo": "test-repo",
    },
    body: JSON.stringify({ force: true }),
  });
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("POST /api/kody/agent-responsibilities/[slug]/run", () => {
  it("dispatches kody.yml with the agentResponsibility action, not the implementation agentAction", async () => {
    const createWorkflowDispatch = vi.fn().mockResolvedValue({ status: 204 });
    const mockOctokit = {
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
        },
        actions: {
          createWorkflowDispatch,
        },
      },
    } as unknown as Awaited<ReturnType<typeof getUserOctokit>>;
    getUserOctokit.mockResolvedValue(mockOctokit);
    readResolvedAgentResponsibilityFile.mockResolvedValue({
      slug: "repo-graph",
      title: "Repo Graph",
      body: "",
      sha: "sha",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastTickAt: null,
      nextEligibleAt: null,
      lastOutcome: null,
      lastDurationMs: null,
      schedule: null,
      capabilityKind: null,
      disabled: false,
      agent: null,
      reviewer: null,
      action: "repo-graph",
      mentions: [],
      agentAction: "refresh-repo-graph",
      agentActions: [],
      agentResponsibilityTools: [],
      tickScript: null,
      readsFrom: [],
      writesTo: [],
      htmlUrl: "https://example.test/repo-graph",
    });

    const res = await POST(
      makeRunRequest("repo-graph"),
      makeParams("repo-graph"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      workflowId: "kody.yml",
      ref: "main",
      action: "repo-graph",
      agentResponsibility: "repo-graph",
      force: true,
    });
    expect(readResolvedAgentResponsibilityFile).toHaveBeenCalledWith(
      "repo-graph",
      mockOctokit,
    );
    expect(createWorkflowDispatch).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      workflow_id: "kody.yml",
      ref: "main",
      inputs: { agentAction: "repo-graph" },
    });
    expect(clearGitHubContext).toHaveBeenCalledTimes(1);
  });
});
