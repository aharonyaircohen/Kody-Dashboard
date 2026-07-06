import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
    storeRepoUrl: "aharonyaircohen/kody-store",
    storeRef: "main",
  })),
  getUserOctokit: vi.fn(),
}));

const githubClient = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

const capabilities = vi.hoisted(() => ({
  listStoreCapabilityFiles: vi.fn(),
}));

const agents = vi.hoisted(() => ({
  listStoreAgentFiles: vi.fn(),
}));

const commands = vi.hoisted(() => ({
  listStoreCommandFiles: vi.fn(),
}));

const managedGoals = vi.hoisted(() => ({
  listCompanyStoreGoalTemplateFiles: vi.fn(),
  managedGoalModel: vi.fn(),
}));

const workflows = vi.hoisted(() => ({
  listCompanyStoreWorkflowDefinitionFiles: vi.fn(),
}));

const engineConfig = vi.hoisted(() => ({
  getEngineConfig: vi.fn(),
}));

function storeUrl(slug: string): string {
  return `https://github.com/acme/store/tree/main/.kody/capabilities/${slug}`;
}

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: githubClient.setGitHubContext,
  clearGitHubContext: githubClient.clearGitHubContext,
}));

vi.mock("@dashboard/lib/capabilities", () => ({
  listStoreCapabilityFiles: capabilities.listStoreCapabilityFiles,
}));

vi.mock("@dashboard/lib/agent-files", () => ({
  listStoreAgentFiles: agents.listStoreAgentFiles,
}));

vi.mock("@dashboard/lib/commands/files", () => ({
  listStoreCommandFiles: commands.listStoreCommandFiles,
}));

vi.mock("@dashboard/lib/managed-goals-files", () => ({
  listCompanyStoreGoalTemplateFiles:
    managedGoals.listCompanyStoreGoalTemplateFiles,
}));

vi.mock("@dashboard/lib/managed-goals", () => ({
  managedGoalModel: managedGoals.managedGoalModel,
}));

vi.mock("@dashboard/lib/workflow-definition-files", () => ({
  listCompanyStoreWorkflowDefinitionFiles:
    workflows.listCompanyStoreWorkflowDefinitionFiles,
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: engineConfig.getEngineConfig,
}));

import { GET } from "../../app/api/kody/store-catalog/route";

function req(): NextRequest {
  return new NextRequest("http://localhost/api/kody/store-catalog");
}

describe("store catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getUserOctokit.mockResolvedValue({});
    capabilities.listStoreCapabilityFiles.mockResolvedValue([]);
    agents.listStoreAgentFiles.mockResolvedValue([]);
    commands.listStoreCommandFiles.mockResolvedValue([]);
    managedGoals.listCompanyStoreGoalTemplateFiles.mockResolvedValue([]);
    workflows.listCompanyStoreWorkflowDefinitionFiles.mockResolvedValue([]);
    engineConfig.getEngineConfig.mockResolvedValue({
      config: {
        defaultImplementation: "run",
        company: {},
      },
      sha: "config-sha",
    });
  });

  it("marks capability profiles with workflow steps for the Workflows tab", async () => {
    capabilities.listStoreCapabilityFiles.mockResolvedValue([
      {
        slug: "bug",
        describe: "Run the full Bug Flow.",
        htmlUrl: storeUrl("bug"),
        agent: "kody",
        every: null,
        isWorkflow: true,
        workflowSteps: ["reproduce", "plan", "run", "review", "fix"],
      },
      {
        slug: "run",
        describe: "Implement one scoped issue.",
        htmlUrl: storeUrl("run"),
        agent: "kody",
        every: null,
        isWorkflow: false,
        workflowSteps: [],
      },
    ]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      items: [
        {
          slug: "bug",
          kind: "capability",
          isWorkflow: true,
          workflowSteps: ["reproduce", "plan", "run", "review", "fix"],
          installed: false,
        },
        {
          slug: "run",
          kind: "capability",
          isWorkflow: false,
          workflowSteps: [],
          installed: false,
        },
      ],
    });
  });

  it("marks items installed from the active company config", async () => {
    capabilities.listStoreCapabilityFiles.mockResolvedValue([
      {
        slug: "release-watch",
        describe: "Keep releases moving.",
        htmlUrl: storeUrl("release-watch"),
        agent: "atlas-agent",
      },
    ]);
    agents.listStoreAgentFiles.mockResolvedValue([
      {
        slug: "atlas-agent",
        title: "Atlas Agent",
        body: "Coordinates delivery.",
        htmlUrl: null,
      },
    ]);
    commands.listStoreCommandFiles.mockResolvedValue([
      {
        slug: "factory",
        description: "Draft factory changes.",
        body: "",
        htmlUrl: null,
      },
    ]);
    managedGoals.managedGoalModel.mockReturnValue("agentGoal");
    managedGoals.listCompanyStoreGoalTemplateFiles.mockResolvedValue([
      {
        id: "weekly-quality",
        state: {
          destination: { outcome: "Weekly Quality", evidence: [] },
          capabilities: ["release-watch"],
          route: [],
          schedule: "1w",
        },
      },
    ]);
    workflows.listCompanyStoreWorkflowDefinitionFiles.mockResolvedValue([
      {
        id: "release-workflow",
        workflow: {
          name: "Release Workflow",
          capabilities: ["release-watch"],
        },
        htmlUrl: null,
      },
    ]);
    engineConfig.getEngineConfig.mockResolvedValue({
      config: {
        defaultImplementation: "run",
        company: {
          activeAgents: ["atlas-agent"],
          activeCapabilities: ["release-watch"],
          activeCommands: ["factory"],
          activeGoals: [{ template: "weekly-quality", every: "1w" }],
          activeWorkflows: ["release-workflow"],
        },
      },
      sha: "config-sha",
    });

    const res = await GET(req());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(
      Object.fromEntries(
        json.items.map(
          (item: { kind: string; slug: string; installed: boolean }) => [
            `${item.kind}:${item.slug}`,
            item.installed,
          ],
        ),
      ),
    ).toMatchObject({
      "agent:atlas-agent": true,
      "capability:release-watch": true,
      "command:factory": true,
      "agentGoal:weekly-quality": true,
      "workflow:release-workflow": true,
    });
    const byKey = Object.fromEntries(
      json.items.map(
        (item: {
          kind: string;
          slug: string;
          uninstallBlockedBy?: Array<{
            kind: string;
            slug: string;
            title?: string;
          }>;
        }) => [`${item.kind}:${item.slug}`, item],
      ),
    );
    expect(byKey["agent:atlas-agent"].uninstallBlockedBy).toEqual([
      {
        kind: "capability",
        slug: "release-watch",
        title: "release-watch",
      },
    ]);
    expect(byKey["capability:release-watch"].uninstallBlockedBy).toEqual(
      expect.arrayContaining([
        {
          kind: "workflow",
          slug: "release-workflow",
          title: "Release Workflow",
        },
        {
          kind: "agentGoal",
          slug: "weekly-quality",
          title: "Weekly Quality",
        },
      ]),
    );
  });
});
