import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(async () => ({ __octokit: true })),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "alice", avatar_url: "u", githubId: 1 },
  })),
}));

const engineConfig = vi.hoisted(() => ({
  getEngineConfig: vi.fn(),
  writeConfigPatch: vi.fn(async () => ({ sha: "new-sha" })),
  VALID_ASSOCIATIONS: [
    "OWNER",
    "MEMBER",
    "COLLABORATOR",
    "CONTRIBUTOR",
    "FIRST_TIMER",
    "FIRST_TIME_CONTRIBUTOR",
    "MANNEQUIN",
    "NONE",
  ] as const,
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
  verifyActorLogin: auth.verifyActorLogin,
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: engineConfig.getEngineConfig,
  writeConfigPatch: engineConfig.writeConfigPatch,
  VALID_ASSOCIATIONS: engineConfig.VALID_ASSOCIATIONS,
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { PATCH } from "../../app/api/kody/company/config/route";

function patchReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/company/config", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: {
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
      "content-type": "application/json",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  engineConfig.getEngineConfig.mockResolvedValue({
    config: {
      agentActions: { default: "run" },
      github: { owner: "acme", repo: "widgets" },
      company: {
        activeAgentResponsibilities: ["release"],
        activeGoals: ["web-release"],
      },
    },
    sha: "stored-sha",
  });
});

describe("PATCH /api/kody/company/config store activation", () => {
  it("forwards active store references as catalog-only config patch", async () => {
    const res = await PATCH(
      patchReq({
        activeAgents: ["cto"],
        activeAgentActions: ["run"],
        activeAgentResponsibilities: ["release"],
        activeGoals: ["web-release", { template: "weekly-check", every: "1w" }],
        actorLogin: "alice",
      }),
    );

    expect(res.status).toBe(200);
    const calls = engineConfig.writeConfigPatch.mock.calls as unknown as Array<
      [unknown, unknown, unknown, Record<string, unknown>]
    >;
    expect(calls).toHaveLength(1);
    const patch = calls[0]![3];
    expect(patch.activeAgents).toEqual(["cto"]);
    expect(patch.activeAgentActions).toEqual(["run"]);
    expect(patch.activeAgentResponsibilities).toEqual(["release"]);
    expect(patch.activeGoals).toEqual([
      "web-release",
      { template: "weekly-check", every: "1w" },
    ]);
  });

  it("rejects invalid active store reference slugs", async () => {
    const res = await PATCH(
      patchReq({
        activeAgentResponsibilities: ["../release"],
        actorLogin: "alice",
      }),
    );

    expect(res.status).toBe(400);
    expect(engineConfig.writeConfigPatch).not.toHaveBeenCalled();
  });
});
