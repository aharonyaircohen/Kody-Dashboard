/** @fileoverview Unit tests for managed goal creation route. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  listManagedGoalFiles: vi.fn(async () => []),
  listCompanyStoreGoalTemplateFiles: vi.fn(async () => []),
  readManagedGoalFile: vi.fn(),
  writeManagedGoalFile: vi.fn(),
  getUserOctokit: vi.fn(),
  getEngineConfig: vi.fn(async () => ({ config: {}, sha: null })),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "tester" },
  })),
  getUserOctokit: h.getUserOctokit,
  getRequestAuth: vi.fn(() => ({
    owner: "test-owner",
    repo: "test-repo",
    token: "ghp_test-token",
  })),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/managed-goals-files", () => ({
  listManagedGoalFiles: h.listManagedGoalFiles,
  listCompanyStoreGoalTemplateFiles: h.listCompanyStoreGoalTemplateFiles,
  readManagedGoalFile: h.readManagedGoalFile,
  writeManagedGoalFile: h.writeManagedGoalFile,
}));
vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
}));

import { GET, POST } from "../../app/api/kody/goals/managed/route";

function createRequest(body: unknown) {
  return new NextRequest("https://dash.test/api/kody/goals/managed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "test-owner",
      "x-kody-repo": "test-repo",
    },
    body: JSON.stringify(body),
  });
}

function listRequest() {
  return new NextRequest("https://dash.test/api/kody/goals/managed", {
    method: "GET",
    headers: {
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "test-owner",
      "x-kody-repo": "test-repo",
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/kody/goals/managed", () => {
  it("creates a goal with the user-managed route order", async () => {
    h.readManagedGoalFile.mockResolvedValue(null);
    h.writeManagedGoalFile.mockResolvedValue(undefined);
    h.getUserOctokit.mockResolvedValue({
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: "main" } })),
        },
        actions: {
          createWorkflowDispatch: vi.fn(async () => undefined),
        },
      },
    });

    const route = [
      {
        stage: "review",
        evidence: "changeVerified",
        capability: "review",
        saveReport: true,
      },
      {
        stage: "implement",
        evidence: "changeImplemented",
        capability: "fix",
      },
    ];

    const res = await POST(
      createRequest({
        type: "improve",
        schedule: "manual",
        outcome: "Goal creation works from the dashboard.",
        evidence: ["changeVerified", "changeImplemented"],
        capabilities: ["review", "fix"],
        route,
      }),
    );

    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.error).toBeUndefined();
    expect(h.writeManagedGoalFile).toHaveBeenCalledTimes(1);
    const write = h.writeManagedGoalFile.mock.calls[0]![0];
    expect(write.id).toBe("goal-creation-works-from-the-dashboard");
    expect(write.state.destination.evidence).toEqual([
      "changeVerified",
      "changeImplemented",
    ]);
    expect(write.state.route).toEqual(route);
    expect(write.state.stage).toBe("review");
  });

  it("creates a route-free agentLoop", async () => {
    h.readManagedGoalFile.mockResolvedValue(null);
    h.writeManagedGoalFile.mockResolvedValue(undefined);
    h.getUserOctokit.mockResolvedValue({
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: "main" } })),
        },
        actions: {
          createWorkflowDispatch: vi.fn(async () => undefined),
        },
      },
    });

    const res = await POST(
      createRequest({
        type: "agentLoop",
        schedule: "1d",
        outcome: "Keep codebase healthy report drift.",
        saveReport: true,
        evidence: [],
        capabilities: ["code-health", "docs-health"],
        route: [],
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.error).toBeUndefined();
    expect(h.writeManagedGoalFile).toHaveBeenCalledTimes(1);
    const write = h.writeManagedGoalFile.mock.calls[0]![0];
    expect(write.id).toBe("keep-codebase-healthy-report-drift");
    expect(write.state).toMatchObject({
      type: "agentLoop",
        schedule: "1d",
        scheduleMode: "agentLoop",
        saveReport: true,
        destination: {
        outcome: "Keep codebase healthy report drift.",
        evidence: [],
      },
      capabilities: ["code-health", "docs-health"],
      route: [],
      facts: { goalType: "agentLoop" },
    });
  });
});

describe("GET /api/kody/goals/managed", () => {
  it("lists active Store goals from config without listing entire Store", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.listManagedGoalFiles.mockResolvedValue([]);
    h.getEngineConfig.mockResolvedValue({
      config: { company: { activeGoals: ["web-release"] } },
      sha: null,
    });
    h.listCompanyStoreGoalTemplateFiles.mockResolvedValue([
      {
        id: "web-release",
        path: ".kody/goals/templates/web-release/state.json",
        source: "store",
        recordType: "template",
        state: {
          version: 1,
          kind: "template",
          state: "inactive",
          type: "release",
          destination: {
            outcome: "Ship web release.",
            evidence: ["releaseDone"],
          },
          capabilities: ["release"],
          route: [],
          facts: {},
          blockers: [],
        },
      },
      {
        id: "codebase-health",
        path: ".kody/goals/templates/codebase-health/state.json",
        source: "store",
        recordType: "template",
        state: {
          version: 1,
          kind: "template",
          state: "inactive",
          type: "standing",
          destination: {
            outcome: "Keep codebase healthy.",
            evidence: ["healthChecked"],
          },
          capabilities: ["code-health"],
          route: [],
          facts: {},
          blockers: [],
        },
      },
    ] as never);

    const res = await GET(listRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.goals.map((goal: { id: string }) => goal.id)).toEqual([
      "web-release",
    ]);
  });
});
