import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const companyStore = vi.hoisted(() => ({
  listCompanyStoreAssetSlugs: vi.fn(),
  listCompanyStoreMarkdownAssetSlugs: vi.fn(),
}));

const managedGoals = vi.hoisted(() => ({
  listCompanyStoreGoalTemplateFiles: vi.fn(),
}));

const capabilities = vi.hoisted(() => ({
  readResolvedCapabilityFile: vi.fn(),
}));

const engineConfig = vi.hoisted(() => ({
  getEngineConfig: vi.fn(),
  writeConfigPatch: vi.fn(),
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
  listCompanyStoreAssetSlugs: companyStore.listCompanyStoreAssetSlugs,
  listCompanyStoreMarkdownAssetSlugs:
    companyStore.listCompanyStoreMarkdownAssetSlugs,
}));

vi.mock("@dashboard/lib/managed-goals-files", () => ({
  listCompanyStoreGoalTemplateFiles:
    managedGoals.listCompanyStoreGoalTemplateFiles,
}));

vi.mock("@dashboard/lib/capabilities", () => ({
  readResolvedCapabilityFile: capabilities.readResolvedCapabilityFile,
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: engineConfig.getEngineConfig,
  writeConfigPatch: engineConfig.writeConfigPatch,
}));

import { POST } from "../../app/api/kody/store-catalog/import/route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/kody/store-catalog/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function baseConfig() {
  return {
    config: {
      executables: { default: "run" },
      company: {
        activeAgents: [],
        activeCapabilities: [],
        activeCommands: [],
        activeGoals: [],
      },
    },
    sha: "config-sha",
  };
}

function makeOctokit() {
  return {
    repos: {
      getContent: vi.fn(),
    },
    git: {
      createTree: vi.fn(),
    },
  };
}

describe("store catalog import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companyStore.listCompanyStoreMarkdownAssetSlugs.mockImplementation(
      async (_octokit: unknown, kind: string) =>
        kind === "commands" ? ["factory"] : ["atlas-agent"],
    );
    companyStore.listCompanyStoreAssetSlugs.mockImplementation(
      async (_octokit: unknown, kind: string) => {
        if (kind === "capabilities") {
          return [
            "ship-feature",
            "release-watch",
            "release-prepare",
            "release-merge",
            "vercel-production-deploy",
          ];
        }
        return [];
      },
    );
    managedGoals.listCompanyStoreGoalTemplateFiles.mockResolvedValue([
      {
        id: "weekly-quality",
        state: { capabilities: ["release-watch"] },
      },
      {
        id: "daily-triage",
        state: { capabilities: ["release-watch"] },
      },
    ]);
    capabilities.readResolvedCapabilityFile.mockImplementation(
      async (slug: string) =>
        ["ship-feature", "release-watch"].includes(slug)
          ? {
              slug,
              agent: slug === "release-watch" ? "atlas-agent" : null,
            }
          : null,
    );
    engineConfig.getEngineConfig.mockResolvedValue(baseConfig());
    engineConfig.writeConfigPatch.mockResolvedValue({ sha: "next-sha" });
  });

  it("adds a store agent by config reference without copying files", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const res = await POST(req({ kind: "agent", slug: "atlas-agent" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      kind: "agent",
      slug: "atlas-agent",
      imported: true,
      path: "company.activeAgents",
    });
    expect(engineConfig.writeConfigPatch).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      {
        activeAgents: ["atlas-agent"],
        activeCapabilities: undefined,
        activeCommands: undefined,
        activeGoals: undefined,
      },
      "chore(kody): add store agent atlas-agent",
    );
    expect(octokit.repos.getContent).not.toHaveBeenCalled();
    expect(octokit.git.createTree).not.toHaveBeenCalled();
  });

  it("adds a store capability by config reference without copying files", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const res = await POST(req({ kind: "capability", slug: "ship-feature" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      kind: "capability",
      slug: "ship-feature",
      imported: true,
      path: "company.activeCapabilities",
    });
    expect(engineConfig.writeConfigPatch).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      {
        activeAgents: undefined,
        activeCapabilities: ["ship-feature"],
        activeCommands: undefined,
        activeGoals: undefined,
      },
      "chore(kody): add store capability ship-feature",
    );
    expect(octokit.repos.getContent).not.toHaveBeenCalled();
    expect(octokit.git.createTree).not.toHaveBeenCalled();
  });

  it("adds store goal and command types with their active capability dependencies", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    await POST(req({ kind: "agentGoal", slug: "weekly-quality" }));
    await POST(req({ kind: "agentLoop", slug: "daily-triage" }));
    await POST(req({ kind: "command", slug: "factory" }));

    expect(engineConfig.writeConfigPatch).toHaveBeenNthCalledWith(
      1,
      octokit,
      "acme",
      "widgets",
      {
        activeAgents: ["atlas-agent"],
        activeCapabilities: ["release-watch"],
        activeCommands: undefined,
        activeGoals: ["weekly-quality"],
      },
      "chore(kody): add store agentGoal weekly-quality",
    );
    expect(engineConfig.writeConfigPatch).toHaveBeenNthCalledWith(
      2,
      octokit,
      "acme",
      "widgets",
      {
        activeAgents: ["atlas-agent"],
        activeCapabilities: ["release-watch"],
        activeCommands: undefined,
        activeGoals: ["daily-triage"],
      },
      "chore(kody): add store agentLoop daily-triage",
    );
    expect(engineConfig.writeConfigPatch).toHaveBeenNthCalledWith(
      3,
      octokit,
      "acme",
      "widgets",
      {
        activeAgents: undefined,
        activeCapabilities: undefined,
        activeCommands: ["factory"],
        activeGoals: undefined,
      },
      "chore(kody): add store command factory",
    );
  });

  it("imports web-release with release-prepare dependencies", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    managedGoals.listCompanyStoreGoalTemplateFiles.mockResolvedValue([
      {
        id: "web-release",
        state: {
          capabilities: [
            "release-prepare",
            "release-merge",
            "vercel-production-deploy",
          ],
        },
      },
    ]);
    capabilities.readResolvedCapabilityFile.mockImplementation(
      async (slug: string) =>
        [
          "release-prepare",
          "release-merge",
          "vercel-production-deploy",
        ].includes(slug)
          ? {
              slug,
              agent: null,
            }
          : null,
    );

    const res = await POST(req({ kind: "agentGoal", slug: "web-release" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      imported: true,
      status: "imported",
      path: "company.activeGoals",
    });
    expect(engineConfig.writeConfigPatch).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      {
        activeAgents: undefined,
        activeCapabilities: [
          "release-prepare",
          "release-merge",
          "vercel-production-deploy",
        ],
        activeCommands: undefined,
        activeGoals: ["web-release"],
      },
      "chore(kody): add store agentGoal web-release",
    );
  });

  it("does not rewrite config when a store item is already linked", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    engineConfig.getEngineConfig.mockResolvedValue({
      config: {
        executables: { default: "run" },
        company: {
          activeAgents: ["atlas-agent"],
        },
      },
      sha: "config-sha",
    });

    const res = await POST(req({ kind: "agent", slug: "atlas-agent" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      imported: false,
      status: "already_local",
      path: "company.activeAgents",
    });
    expect(engineConfig.writeConfigPatch).not.toHaveBeenCalled();
  });

  it("does not duplicate a goal already linked by template object", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    engineConfig.getEngineConfig.mockResolvedValue({
      config: {
        executables: { default: "run" },
        company: {
          activeAgents: ["atlas-agent"],
          activeCapabilities: ["release-watch"],
          activeGoals: [{ template: "weekly-quality", every: "1w" }],
        },
      },
      sha: "config-sha",
    });

    const res = await POST(req({ kind: "agentGoal", slug: "weekly-quality" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      imported: false,
      status: "already_local",
      path: "company.activeGoals",
    });
    expect(engineConfig.writeConfigPatch).not.toHaveBeenCalled();
  });

  it("adds missing dependencies when selected goal is already linked", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    engineConfig.getEngineConfig.mockResolvedValue({
      config: {
        executables: { default: "run" },
        company: {
          activeGoals: [{ template: "weekly-quality", every: "1w" }],
        },
      },
      sha: "config-sha",
    });

    const res = await POST(req({ kind: "agentGoal", slug: "weekly-quality" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      imported: true,
      status: "imported",
      path: "company.activeGoals",
    });
    expect(engineConfig.writeConfigPatch).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      {
        activeAgents: ["atlas-agent"],
        activeCapabilities: ["release-watch"],
        activeCommands: undefined,
        activeGoals: undefined,
      },
      "chore(kody): add store agentGoal weekly-quality",
    );
  });

  it("uses write token identity even when the browser sends an actor", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const res = await POST(
      req({
        kind: "agent",
        slug: "atlas-agent",
        actorLogin: "browser-user",
      }),
    );

    expect(res.status).toBe(200);
    expect(auth.verifyActorLogin).toHaveBeenCalledWith(
      expect.any(NextRequest),
      undefined,
    );
  });

  it("rejects legacy store item kinds", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const res = await POST(req({ kind: "executable", slug: "ship-feature" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "validation_error",
    });
    expect(engineConfig.writeConfigPatch).not.toHaveBeenCalled();
  });
});
