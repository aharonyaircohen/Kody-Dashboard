import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dashboard/lib/github-client", () => ({
  fetchCompanyActivity: vi.fn(async () => []),
  getOctokit: vi.fn(),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
  invalidateAgentResponsibilitiesCache: vi.fn(),
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  deleteStateFile: vi.fn(),
  listStateDirectory: vi.fn(async () => ({
    entries: [],
    targetPath: "repo/agent-responsibilities",
  })),
  readStateText: vi.fn(async () => null),
  resolveStateRepo: vi.fn(async () => ({
    owner: "owner",
    repo: "kody-state",
    basePath: "repo",
  })),
  stateRepoPath: vi.fn((target: { basePath: string }, path: string) =>
    [target.basePath, path].filter(Boolean).join("/"),
  ),
  writeStateText: vi.fn(),
}));

vi.mock("@dashboard/lib/company-store/assets", () => ({
  buildCompanyStoreHtmlUrl: vi.fn(
    (kind: string, slug: string) => `https://store.example/${kind}/${slug}`,
  ),
  companyStoreUpdatedAt: vi.fn(async () => "2026-06-22T00:00:00Z"),
  listCompanyStoreAssetSlugs: vi.fn(async () => ["ci-health"]),
  mergeAssetsBySlug: vi.fn((local: unknown[], store: unknown[]) => [
    ...local,
    ...store,
  ]),
  readCompanyStoreText: vi.fn(async (_octokit: unknown, path: string) => {
    if (path.endsWith("/profile.json")) {
      return JSON.stringify({
        name: "ci-health",
        action: "ci-health",
        agentAction: "ci-check",
        describe: "Check PR CI health.",
      });
    }
    if (path.endsWith("/agent-responsibility.md")) {
      return "# CI Health\n\nCheck PR CI health.\n";
    }
    return null;
  }),
}));

import { getOctokit } from "@dashboard/lib/github-client";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";
import {
  listAgentResponsibilityFiles,
  writeAgentResponsibilityFile,
} from "@dashboard/lib/agent-responsibilities-files";

const getOctokitMock = vi.mocked(getOctokit);
const readStateTextMock = vi.mocked(readStateText);
const writeStateTextMock = vi.mocked(writeStateText);

describe("listAgentResponsibilityFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOctokitMock.mockReturnValue({} as never);
  });

  it("shows Store agentResponsibilities when the state repo has no local agentResponsibilities folder", async () => {
    const files = await listAgentResponsibilityFiles();

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      slug: "ci-health",
      title: "CI Health",
      source: "store",
      readOnly: true,
      agentAction: "ci-check",
    });
  });

  it("updates existing profile.json with its own sha", async () => {
    readStateTextMock.mockImplementation(
      async (_octokit, _owner, _repo, path) => {
        if (path === "agent-responsibilities/ci-health/profile.json") {
          return {
            path,
            content: JSON.stringify({
              name: "ci-health",
              action: "ci-health",
              agentAction: "ci-check",
            }),
            sha: "profile-sha",
          };
        }
        if (
          path === "agent-responsibilities/ci-health/agent-responsibility.md"
        ) {
          return {
            path,
            content: "# CI Health\n\nCheck PR CI health.\n",
            sha: "body-sha",
            htmlUrl: "https://github.example/body",
          };
        }
        return null;
      },
    );
    writeStateTextMock.mockResolvedValue({ sha: "updated-sha" });

    await writeAgentResponsibilityFile({
      octokit: {} as never,
      slug: "ci-health",
      title: "CI Health",
      body: "Check PR CI health.",
      agentAction: "ci-check",
      disabled: true,
      sha: "body-sha",
    });

    expect(writeStateTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: "agent-responsibilities/ci-health/profile.json",
        sha: "profile-sha",
      }),
    );
    expect(writeStateTextMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "agent-responsibilities/ci-health/agent-responsibility.md",
        sha: "body-sha",
      }),
    );
  });
});
