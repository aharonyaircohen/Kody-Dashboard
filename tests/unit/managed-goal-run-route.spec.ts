import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getUserOctokit: vi.fn(),
  readManagedGoalFile: vi.fn(),
  listCompanyStoreGoalTemplateFiles: vi.fn(async () => []),
  writeManagedGoalFile: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  getUserOctokit: h.getUserOctokit,
  getRequestAuth: vi.fn(() => ({
    owner: "test-owner",
    repo: "test-repo",
    token: "ghp_test-token",
  })),
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/managed-goals-files", () => ({
  readManagedGoalFile: h.readManagedGoalFile,
  listCompanyStoreGoalTemplateFiles: h.listCompanyStoreGoalTemplateFiles,
  writeManagedGoalFile: h.writeManagedGoalFile,
}));

import { POST } from "../../app/api/kody/goals/managed/[id]/run/route";

const executableWorkflow = `
name: kody
on:
  workflow_dispatch:
    inputs:
      issue_number:
        type: string
        default: ""
      sessionId:
        type: string
        default: ""
      message:
        type: string
        default: ""
      executable:
        type: string
        default: ""
`;

function makeRequest(id: string) {
  return new NextRequest(`https://dash.test/api/kody/goals/managed/${id}/run`, {
    method: "POST",
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("managed goal run route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches goal-manager with executable when the target workflow declares executable", async () => {
    const createWorkflowDispatch = vi.fn(async () => ({ status: 204 }));
    const getContent = vi.fn(async () => ({
      data: {
        type: "file",
        encoding: "base64",
        content: Buffer.from(executableWorkflow, "utf8").toString("base64"),
      },
    }));
    const mockOctokit = {
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: "main" } })),
          getContent,
        },
        actions: {
          createWorkflowDispatch,
        },
      },
    };

    h.getUserOctokit.mockResolvedValue(mockOctokit);
    h.readManagedGoalFile.mockResolvedValue({
      sha: "state-sha",
      path: ".kody/goals/instances/web-release/state.json",
      state: {
        version: 1,
        state: "active",
        type: "release",
        destination: {
          outcome: "Ship web release.",
          evidence: ["releaseDone"],
        },
        agentResponsibilities: ["release"],
        route: [],
        facts: {},
        blockers: [],
      },
    });

    const res = await POST(
      makeRequest("web-release"),
      makeParams("web-release"),
    );

    expect(res.status).toBe(200);
    expect(getContent).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      path: ".github/workflows/kody.yml",
      ref: "main",
    });
    expect(createWorkflowDispatch).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      workflow_id: "kody.yml",
      ref: "main",
      inputs: {
        executable: "goal-manager",
        message: "web-release",
      },
    });
  });
});
