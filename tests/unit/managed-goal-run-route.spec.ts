import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getUserOctokit: vi.fn(),
  readManagedGoalFile: vi.fn(),
  listCompanyStoreGoalTemplateFiles: vi.fn(async () => []),
  writeManagedGoalFile: vi.fn(),
  runScheduledKodyOnRunner: vi.fn(),
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

vi.mock("@dashboard/lib/runners/kody-runner", () => ({
  runScheduledKodyOnRunner: h.runScheduledKodyOnRunner,
}));

import { POST } from "../../app/api/kody/goals/managed/[id]/run/route";

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

  it("runs goal-manager on the shared scheduled runner", async () => {
    h.runScheduledKodyOnRunner.mockResolvedValue({
      ok: true,
      runner: "fly",
      machineId: "m-goal",
      ref: "main",
    });
    const mockOctokit = {
      rest: {
        repos: {},
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
        capabilities: ["release"],
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
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      runner: "fly",
      machineId: "m-goal",
      ref: "main",
    });
    expect(h.runScheduledKodyOnRunner).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        runRequest: expect.objectContaining({
          target: { type: "goal", id: "web-release" },
          intent: "manage",
        }),
      }),
    );
  });

  it("returns runner_failed when the scheduled runner cannot start", async () => {
    h.runScheduledKodyOnRunner.mockResolvedValue({
      ok: false,
      error: "Fly runner not configured",
      status: 400,
    });
    h.getUserOctokit.mockResolvedValue({ rest: { repos: {} } });
    h.readManagedGoalFile.mockResolvedValue({
      sha: "state-sha",
      path: ".kody/goals/instances/web-release/state.json",
      state: {
        version: 1,
        state: "active",
        type: "release",
        destination: { outcome: "Ship web release.", evidence: [] },
        capabilities: [],
        route: [],
        facts: {},
        blockers: [],
      },
    });

    const res = await POST(
      makeRequest("web-release"),
      makeParams("web-release"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "runner_failed",
      message: "Fly runner not configured",
    });
  });
});
