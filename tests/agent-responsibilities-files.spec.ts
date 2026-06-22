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
  listStateDirectory: vi.fn(async () => ({ entries: [], targetPath: "repo/agent-responsibilities" })),
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
import { listAgentResponsibilityFiles } from "@dashboard/lib/agent-responsibilities-files";

const getOctokitMock = vi.mocked(getOctokit);

describe("listAgentResponsibilityFiles", () => {
  beforeEach(() => {
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
});
