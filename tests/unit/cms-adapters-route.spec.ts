import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
    storeRepoUrl: "https://github.com/acme/kody-store",
    storeRef: "stable",
  })),
  getUserOctokit: vi.fn(async () => ({ __octokit: true })),
}));

const githubClient = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

const adapterCatalog = vi.hoisted(() => ({
  listStoreCmsAdapters: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/github-client", () => githubClient);
vi.mock("@dashboard/lib/logger", () => ({
  logger: { error: vi.fn() },
}));
vi.mock("@dashboard/lib/cms/adapter-catalog", () => adapterCatalog);

import { GET } from "../../app/api/kody/cms/adapters/route";

function req(): NextRequest {
  return new NextRequest("http://localhost/api/kody/cms/adapters");
}

describe("CMS adapters route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterCatalog.listStoreCmsAdapters.mockResolvedValue([
      {
        name: "mongodb",
        label: "MongoDB",
        description: "MongoDB collections",
        supportsSchemaGeneration: true,
        htmlUrl:
          "https://github.com/acme/kody-store/blob/stable/cms/adapters/mongodb/index.mjs",
      },
      {
        name: "github",
        label: "GitHub JSON",
        description: "JSON documents in the state repo",
        supportsSchemaGeneration: false,
        htmlUrl:
          "https://github.com/acme/kody-store/blob/stable/cms/adapters/github/index.mjs",
      },
    ]);
  });

  it("lists Store-owned CMS adapters", async () => {
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(githubClient.setGitHubContext).toHaveBeenCalledWith(
      "acme",
      "widgets",
      "ghp_test",
      "https://github.com/acme/kody-store",
      "stable",
    );
    expect(adapterCatalog.listStoreCmsAdapters).toHaveBeenCalledWith({
      __octokit: true,
    });
    await expect(res.json()).resolves.toMatchObject({
      adapters: [
        { name: "mongodb", label: "MongoDB" },
        { name: "github", label: "GitHub JSON" },
      ],
    });
  });
});
