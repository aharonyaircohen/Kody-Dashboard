import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dashboard/lib/github-client", () => ({
  fetchCompanyActivity: vi.fn(async () => []),
  getOctokit: vi.fn(),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
  invalidateDutiesCache: vi.fn(),
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
        executable: "ci-check",
        describe: "Check PR CI health.",
      });
    }
    if (path.endsWith("/duty.md"))
      return "# CI Health\n\nCheck PR CI health.\n";
    return null;
  }),
}));

import { getOctokit } from "@dashboard/lib/github-client";
import { listDutyFiles } from "@dashboard/lib/duties-files";

const getOctokitMock = vi.mocked(getOctokit);

describe("listDutyFiles", () => {
  beforeEach(() => {
    getOctokitMock.mockReturnValue({
      repos: {
        get: vi.fn(async () => ({ data: { default_branch: "main" } })),
        getContent: vi.fn(async ({ path }: { path: string }) => {
          if (path === ".kody/duties") {
            const error = new Error("not found") as Error & { status: number };
            error.status = 404;
            throw error;
          }
          throw new Error(`unexpected path: ${path}`);
        }),
        listCommits: vi.fn(async () => ({ data: [] })),
      },
    } as never);
  });

  it("shows Store duties when the repo has no local duties folder", async () => {
    const duties = await listDutyFiles();

    expect(duties).toHaveLength(1);
    expect(duties[0]).toMatchObject({
      slug: "ci-health",
      source: "store",
      readOnly: true,
      action: "ci-health",
      executable: "ci-check",
    });
  });
});
