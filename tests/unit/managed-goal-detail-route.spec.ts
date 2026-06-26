/**
 * @fileoverview Unit tests for managed goal detail route updates.
 * @testFramework vitest
 * @domain goals
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ManagedGoalState } from "../../src/dashboard/lib/managed-goals";

const h = vi.hoisted(() => ({
  readManagedGoalFile: vi.fn(),
  writeManagedGoalFile: vi.fn(),
  deleteManagedGoalFile: vi.fn(),
  listManagedGoalFiles: vi.fn(),
  listCompanyStoreGoalTemplateFiles: vi.fn(),
  getEngineConfig: vi.fn(),
  writeConfigPatch: vi.fn(),
  getUserOctokit: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "tester" } })),
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
  readManagedGoalFile: h.readManagedGoalFile,
  writeManagedGoalFile: h.writeManagedGoalFile,
  deleteManagedGoalFile: h.deleteManagedGoalFile,
  listManagedGoalFiles: h.listManagedGoalFiles,
  listCompanyStoreGoalTemplateFiles: h.listCompanyStoreGoalTemplateFiles,
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  writeConfigPatch: h.writeConfigPatch,
}));

import { DELETE, PATCH } from "../../app/api/kody/goals/managed/[id]/route";

function patchRequest(body: unknown) {
  return new NextRequest(
    "https://dash.test/api/kody/goals/managed/codebase-health",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-kody-token": "ghp_test-token",
        "x-kody-owner": "test-owner",
        "x-kody-repo": "test-repo",
      },
      body: JSON.stringify(body),
    },
  );
}

function deleteRequest() {
  return new NextRequest(
    "https://dash.test/api/kody/goals/managed/codebase-health",
    {
      method: "DELETE",
      headers: {
        "x-kody-token": "ghp_test-token",
        "x-kody-owner": "test-owner",
        "x-kody-repo": "test-repo",
      },
    },
  );
}

function params(id = "codebase-health") {
  return { params: Promise.resolve({ id }) };
}

function localGoalState(): ManagedGoalState {
  return {
    version: 1,
    state: "active",
    type: "standing",
    destination: {
      outcome: "The codebase stays maintainable.",
      evidence: [],
    },
    capabilities: ["code-health", "docs-health"],
    route: [],
    stage: "watching",
    facts: {},
    blockers: [],
    schedule: "manual",
  };
}

beforeEach(() => {
  h.listManagedGoalFiles.mockResolvedValue([]);
  h.listCompanyStoreGoalTemplateFiles.mockResolvedValue([]);
  h.getEngineConfig.mockResolvedValue({ config: {}, sha: null });
  h.writeConfigPatch.mockResolvedValue({ sha: "next-sha" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/kody/goals/managed/[id]", () => {
  it("preserves standalone capabilities when route is not edited", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue({
      state: localGoalState(),
      sha: "goal-sha",
      path: "goals/instances/codebase-health/state.json",
    });
    h.writeManagedGoalFile.mockResolvedValue(undefined);

    const res = await PATCH(
      patchRequest({ outcome: "The codebase stays healthy." }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(h.writeManagedGoalFile).toHaveBeenCalledTimes(1);
    const write = h.writeManagedGoalFile.mock.calls[0]![0];
    expect(write.state.capabilities).toEqual([
      "code-health",
      "docs-health",
    ]);
    expect(write.state.route).toEqual([]);
    expect(write.state.stage).toBe("watching");
  });

  it("updates standalone capabilities when capabilities are edited", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue({
      state: localGoalState(),
      sha: "goal-sha",
      path: "goals/instances/codebase-health/state.json",
    });
    h.writeManagedGoalFile.mockResolvedValue(undefined);

    const res = await PATCH(
      patchRequest({ capabilities: ["qa-sweep", "docs-health"] }),
      params(),
    );

    expect(res.status).toBe(200);
    const write = h.writeManagedGoalFile.mock.calls[0]![0];
    expect(write.state.capabilities).toEqual([
      "qa-sweep",
      "docs-health",
    ]);
    expect(write.state.route).toEqual([]);
    expect(write.state.stage).toBe("watching");
  });

  it("updates agentLoop target", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue({
      state: {
        ...localGoalState(),
        type: "agentLoop",
        scheduleMode: "agentLoop",
      },
      sha: "goal-sha",
      path: "goals/instances/codebase-health/state.json",
    });
    h.writeManagedGoalFile.mockResolvedValue(undefined);

    const res = await PATCH(
      patchRequest({
        loopTarget: { type: "goal", id: "web-release" },
        capabilities: [],
      }),
      params(),
    );

    expect(res.status).toBe(200);
    const write = h.writeManagedGoalFile.mock.calls[0]![0];
    expect(write.state.loopTarget).toEqual({
      type: "goal",
      id: "web-release",
    });
    expect(write.state.capabilities).toEqual([]);
    expect(write.state.scheduleMode).toBe("agentLoop");
  });

  it("updates route setup when agentGoal type changes", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue({
      state: {
        ...localGoalState(),
        type: "improve",
        destination: {
          outcome: "Improve release flow.",
          evidence: ["planReady", "changeImplemented", "changeVerified"],
        },
        capabilities: ["plan", "fix", "review"],
        route: [
          {
            stage: "plan",
            evidence: "planReady",
            capability: "plan",
          },
        ],
        stage: "plan",
      },
      sha: "goal-sha",
      path: "goals/instances/codebase-health/state.json",
    });
    h.writeManagedGoalFile.mockResolvedValue(undefined);

    const res = await PATCH(patchRequest({ type: "release" }), params());

    expect(res.status).toBe(200);
    const write = h.writeManagedGoalFile.mock.calls[0]![0];
    expect(write.state.type).toBe("release");
    expect(write.state.destination.evidence).toEqual([
      "releasePrExists",
      "mainMerged",
      "productionDeployed",
    ]);
    expect(write.state.capabilities).toEqual([
      "release-prepare",
      "task-leader",
      "vercel-production-deploy",
    ]);
    expect(
      write.state.route.map((step: { stage: string }) => step.stage),
    ).toEqual(["release", "merge", "publish"]);
    expect(write.state.stage).toBe("release");
  });

  it("creates repo instance when toggling Store goals without copying template fields", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue(null);
    h.listCompanyStoreGoalTemplateFiles.mockResolvedValue([
      {
        id: "codebase-health",
        path: ".kody/goals/templates/codebase-health/state.json",
        source: "store",
        recordType: "template",
        state: {
          ...localGoalState(),
          kind: "template",
          template: true,
          templateId: "codebase-health",
          state: "inactive",
        },
      },
    ]);

    const res = await PATCH(patchRequest({ state: "active" }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.goal.state.state).toBe("active");
    expect(json.goal.state.sourceTemplate).toBe("codebase-health");
    expect(h.writeManagedGoalFile).toHaveBeenCalledTimes(1);
    expect(h.writeManagedGoalFile.mock.calls[0]![0]).toMatchObject({
      id: "codebase-health",
      state: {
        state: "active",
        sourceTemplate: "codebase-health",
      },
    });
    const writtenState = h.writeManagedGoalFile.mock.calls[0]![0]
      .state as ManagedGoalState;
    expect(writtenState.kind).toBeUndefined();
    expect(writtenState.template).toBeUndefined();
    expect(writtenState.templateId).toBeUndefined();
    expect(writtenState.blockers).toEqual([]);
  });

  it("does not edit existing Store-backed goal copies", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue({
      state: {
        ...localGoalState(),
        kind: "template",
        template: true,
        templateId: "codebase-health",
      },
      sha: "goal-sha",
      path: "goals/instances/codebase-health/state.json",
    });

    const res = await PATCH(
      patchRequest({ outcome: "Edited from dashboard." }),
      params(),
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe("store_goal_protected");
    expect(h.writeManagedGoalFile).not.toHaveBeenCalled();
  });

  it("cleans existing Store-backed goal copies when updating state", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue({
      state: {
        ...localGoalState(),
        kind: "template",
        template: true,
        templateId: "codebase-health",
        sourceTemplate: "codebase-health",
        state: "inactive",
      },
      sha: "goal-sha",
      path: "goals/instances/codebase-health/state.json",
    });

    const res = await PATCH(patchRequest({ state: "active" }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.goal.state.state).toBe("active");
    expect(h.writeManagedGoalFile).toHaveBeenCalledTimes(1);
    expect(h.writeManagedGoalFile.mock.calls[0]![0]).toMatchObject({
      sha: "goal-sha",
      state: {
        state: "active",
        sourceTemplate: "codebase-health",
      },
    });
    const writtenState = h.writeManagedGoalFile.mock.calls[0]![0]
      .state as ManagedGoalState;
    expect(writtenState.kind).toBeUndefined();
    expect(writtenState.template).toBeUndefined();
    expect(writtenState.templateId).toBeUndefined();
    expect(writtenState.blockers).toEqual([]);
  });
});

describe("DELETE /api/kody/goals/managed/[id]", () => {
  it("deletes Store-derived runtime instances from the repo", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue({
      state: {
        ...localGoalState(),
        sourceTemplate: "codebase-health",
      },
      sha: "goal-sha",
      path: "goals/instances/codebase-health/state.json",
    });
    h.deleteManagedGoalFile.mockResolvedValue(undefined);

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    expect(h.deleteManagedGoalFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "codebase-health",
        sha: "goal-sha",
      }),
    );
  });

  it("deletes generated Store-backed instances by visible template id", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        state: {
          ...localGoalState(),
          sourceTemplate: "codebase-health",
        },
        sha: "goal-sha-1",
        path: "goals/instances/codebase-health-a1/state.json",
      })
      .mockResolvedValueOnce({
        state: {
          ...localGoalState(),
          sourceTemplate: "codebase-health",
        },
        sha: "goal-sha-2",
        path: "goals/instances/codebase-health-a2/state.json",
      });
    h.listManagedGoalFiles.mockResolvedValue([
      {
        id: "codebase-health-a1",
        path: "goals/instances/codebase-health-a1/state.json",
        source: "local",
        recordType: "instance",
        state: {
          ...localGoalState(),
          sourceTemplate: "codebase-health",
        },
      },
      {
        id: "codebase-health-a2",
        path: "goals/instances/codebase-health-a2/state.json",
        source: "local",
        recordType: "instance",
        state: {
          ...localGoalState(),
          sourceTemplate: "codebase-health",
        },
      },
    ]);
    h.deleteManagedGoalFile.mockResolvedValue(undefined);

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    expect(h.deleteManagedGoalFile).toHaveBeenCalledTimes(2);
    expect(h.deleteManagedGoalFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "codebase-health-a1",
        sha: "goal-sha-1",
      }),
    );
    expect(h.deleteManagedGoalFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "codebase-health-a2",
        sha: "goal-sha-2",
      }),
    );
  });

  it("removes active Store references that have no repo instance", async () => {
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readManagedGoalFile.mockResolvedValue(null);
    h.listManagedGoalFiles.mockResolvedValue([]);
    h.listCompanyStoreGoalTemplateFiles.mockResolvedValue([
      {
        id: "codebase-health",
        path: ".kody/goals/templates/codebase-health/state.json",
        source: "store",
        recordType: "template",
        state: localGoalState(),
      },
    ]);
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeGoals: [
            "codebase-health",
            { template: "release-safety", every: "1d" },
          ],
        },
      },
      sha: "config-sha",
    });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, removedReference: true });
    expect(h.deleteManagedGoalFile).not.toHaveBeenCalled();
    expect(h.writeConfigPatch).toHaveBeenCalledWith(
      { rest: {} },
      "test-owner",
      "test-repo",
      {
        activeGoals: [{ template: "release-safety", every: "1d" }],
      },
      "chore(goals): remove store goal codebase-health",
    );
  });
});
