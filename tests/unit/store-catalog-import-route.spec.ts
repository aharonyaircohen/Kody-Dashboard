import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "alice", avatar_url: "u", githubId: 1 },
  })),
}));

const githubClient = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

const storeAssets = vi.hoisted(() => ({
  getCompanyStoreTarget: vi.fn(() => ({
    owner: "store-owner",
    repo: "store-repo",
    ref: "stable",
  })),
}));

const managedGoals = vi.hoisted(() => ({
  listCompanyStoreGoalTemplateFiles: vi.fn(),
  readManagedGoalFile: vi.fn(),
  writeManagedGoalFile: vi.fn(),
}));

const stateRepo = vi.hoisted(() => ({
  listStateDirectory: vi.fn(),
  readStateText: vi.fn(),
  writeStateText: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
  verifyActorLogin: auth.verifyActorLogin,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: githubClient.setGitHubContext,
  clearGitHubContext: githubClient.clearGitHubContext,
}));

vi.mock("@dashboard/lib/company-store/assets", () => ({
  getCompanyStoreTarget: storeAssets.getCompanyStoreTarget,
}));

vi.mock("@dashboard/lib/managed-goals-files", () => ({
  listCompanyStoreGoalTemplateFiles:
    managedGoals.listCompanyStoreGoalTemplateFiles,
  readManagedGoalFile: managedGoals.readManagedGoalFile,
  writeManagedGoalFile: managedGoals.writeManagedGoalFile,
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  listStateDirectory: stateRepo.listStateDirectory,
  readStateText: stateRepo.readStateText,
  writeStateText: stateRepo.writeStateText,
}));

import { POST } from "../../app/api/kody/store-catalog/import/route";

function req(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/store-catalog/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
  });
}

function b64(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

function makeOctokit() {
  const createTree = vi.fn(
    async (_opts: { tree: Array<{ path: string }> }) => ({
      data: { sha: "tree-next" },
    }),
  );
  return {
    repos: {
      get: vi.fn(async () => ({ data: { default_branch: "main" } })),
      getContent: vi.fn(async (opts: { owner: string; path: string }) => {
        if (opts.owner === "acme") {
          throw { status: 404 };
        }
        if (opts.path === ".kody/agent-actions/ship-feature") {
          return {
            data: [
              {
                name: "profile.json",
                path: ".kody/agent-actions/ship-feature/profile.json",
                type: "file",
              },
              {
                name: "prompt.md",
                path: ".kody/agent-actions/ship-feature/prompt.md",
                type: "file",
              },
              {
                name: "skills",
                path: ".kody/agent-actions/ship-feature/skills",
                type: "dir",
              },
            ],
          };
        }
        if (opts.path === ".kody/agent-actions/ship-feature/skills") {
          return {
            data: [
              {
                name: "qa",
                path: ".kody/agent-actions/ship-feature/skills/qa",
                type: "dir",
              },
            ],
          };
        }
        if (opts.path === ".kody/agent-actions/ship-feature/skills/qa") {
          return {
            data: [
              {
                name: "SKILL.md",
                path: ".kody/agent-actions/ship-feature/skills/qa/SKILL.md",
                type: "file",
              },
            ],
          };
        }
        if (opts.path === ".kody/agent-responsibilities/release-watch") {
          return {
            data: [
              {
                name: "profile.json",
                path: ".kody/agent-responsibilities/release-watch/profile.json",
                type: "file",
              },
              {
                name: "agent-responsibility.md",
                path: ".kody/agent-responsibilities/release-watch/agent-responsibility.md",
                type: "file",
              },
            ],
          };
        }
        const files: Record<string, string> = {
          ".kody/agents/atlas-agent.md": "# Atlas Agent\nCoordinates work.\n",
          ".kody/agent-responsibilities/release-watch/profile.json":
            '{"name":"Release Watch","agent":"atlas-agent"}\n',
          ".kody/agent-responsibilities/release-watch/agent-responsibility.md":
            "# Release Watch\nKeep release work moving.\n",
          ".kody/agent-actions/ship-feature/profile.json":
            '{"describe":"Ship feature"}\n',
          ".kody/agent-actions/ship-feature/prompt.md": "Do the work.\n",
          ".kody/agent-actions/ship-feature/skills/qa/SKILL.md":
            "# QA\nCheck behavior.\n",
        };
        const content = files[opts.path];
        if (!content) throw { status: 404 };
        return { data: { type: "file", content: b64(content) } };
      }),
    },
    git: {
      getRef: vi.fn(async () => ({ data: { object: { sha: "base-sha" } } })),
      getCommit: vi.fn(async () => ({
        data: { tree: { sha: "tree-base" } },
      })),
      createBlob: vi.fn(async () => ({ data: { sha: crypto.randomUUID() } })),
      createTree,
      createCommit: vi.fn(async () => ({ data: { sha: "commit-next" } })),
      updateRef: vi.fn(async () => ({})),
    },
  };
}

describe("store catalog import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managedGoals.readManagedGoalFile.mockResolvedValue(null);
    managedGoals.writeManagedGoalFile.mockResolvedValue(undefined);
    stateRepo.readStateText.mockResolvedValue(null);
    stateRepo.listStateDirectory.mockResolvedValue({ entries: [] });
    stateRepo.writeStateText.mockResolvedValue(undefined);
  });

  it("imports a store agent into the configured state repo", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const res = await POST(req({ kind: "agent", slug: "atlas-agent" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      kind: "agent",
      slug: "atlas-agent",
      imported: true,
      path: "agents/atlas-agent.md",
    });
    expect(stateRepo.readStateText).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      "agents/atlas-agent.md",
    );
    expect(stateRepo.writeStateText).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      path: "agents/atlas-agent.md",
      content: "# Atlas Agent\nCoordinates work.\n",
      message: "feat(store): import atlas-agent",
    });
    expect(octokit.git.createTree).not.toHaveBeenCalled();
  });

  it("imports a store responsibility folder into the configured state repo", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const res = await POST(
      req({ kind: "agentResponsibility", slug: "release-watch" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      kind: "agentResponsibility",
      slug: "release-watch",
      imported: true,
      path: "agent-responsibilities/release-watch",
    });
    expect(stateRepo.listStateDirectory).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      "agent-responsibilities/release-watch",
    );
    expect(stateRepo.writeStateText).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      path: "agent-responsibilities/release-watch/profile.json",
      content: '{"name":"Release Watch","agent":"atlas-agent"}\n',
      message: "feat(store): import release-watch",
    });
    expect(stateRepo.writeStateText).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      path: "agent-responsibilities/release-watch/agent-responsibility.md",
      content: "# Release Watch\nKeep release work moving.\n",
      message: "feat(store): import release-watch",
    });
    expect(octokit.git.createTree).not.toHaveBeenCalled();
  });

  it("copies a store agentAction folder into the connected repo", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const res = await POST(
      req({
        kind: "agentAction",
        slug: "ship-feature",
        actorLogin: "alice",
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      kind: "agentAction",
      slug: "ship-feature",
      imported: true,
      path: ".kody/agent-actions/ship-feature",
    });
    expect(octokit.git.createTree).toHaveBeenCalledTimes(1);
    const createTreeCall = octokit.git.createTree.mock.calls[0]!;
    const tree = createTreeCall[0].tree;
    expect(tree.map((entry: { path: string }) => entry.path).sort()).toEqual([
      ".kody/agent-actions/ship-feature/profile.json",
      ".kody/agent-actions/ship-feature/prompt.md",
      ".kody/agent-actions/ship-feature/skills/qa/SKILL.md",
    ]);
    expect(octokit.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
        sha: "commit-next",
      }),
    );
  });

  it("uses the write token identity even when the browser sends an actor", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const res = await POST(
      req({
        kind: "agentAction",
        slug: "ship-feature",
        actorLogin: "browser-user",
      }),
    );

    expect(res.status).toBe(200);
    expect(auth.verifyActorLogin).toHaveBeenCalledWith(
      expect.any(NextRequest),
      undefined,
    );
  });

  it("instantiates a store goal template as a local managed goal file", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    managedGoals.listCompanyStoreGoalTemplateFiles.mockResolvedValue([
      {
        id: "weekly-quality",
        path: ".kody/goals/templates/weekly-quality/state.json",
        source: "store",
        recordType: "template",
        state: {
          version: 1,
          state: "inactive",
          type: "improve",
          destination: {
            outcome: "Improve quality",
            evidence: ["changeVerified"],
          },
          agentResponsibilities: ["release-watch"],
          route: [
            {
              stage: "verify",
              evidence: "changeVerified",
              agentResponsibility: "release-watch",
              agentAction: "ship-feature",
            },
          ],
          schedule: "manual",
          stage: "verify",
          facts: { changeVerified: false },
          blockers: ["template blocker should not copy"],
        },
      },
    ]);

    const res = await POST(
      req({
        kind: "agentGoal",
        slug: "weekly-quality",
        actorLogin: "alice",
      }),
    );

    expect(res.status).toBe(200);
    expect(managedGoals.writeManagedGoalFile).toHaveBeenCalledWith(
      expect.objectContaining({
        octokit,
        owner: "acme",
        repo: "widgets",
        id: "weekly-quality",
        message: "feat(store): import weekly-quality",
        state: expect.objectContaining({
          sourceTemplate: "weekly-quality",
          state: "inactive",
          type: "improve",
          facts: { changeVerified: false },
          blockers: [],
        }),
      }),
    );
  });
});
