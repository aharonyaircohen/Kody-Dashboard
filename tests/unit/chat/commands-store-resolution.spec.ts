import { beforeEach, describe, expect, it, vi } from "vitest";

const getContent = vi.fn();
const listCommits = vi.fn();
const octokit = {
  repos: {
    get: vi.fn(async () => ({ data: { default_branch: "main" } })),
    getContent,
    listCommits,
  },
};

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: vi.fn(() => octokit),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
  invalidateCommandsCache: vi.fn(),
  getStoreRef: vi.fn(() => "stable"),
  getStoreRepoUrl: vi.fn(
    () => "https://github.com/aharonyaircohen/kody-company-store",
  ),
}));

vi.mock("@dashboard/lib/company-store/assets", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@dashboard/lib/company-store/assets")
    >();
  return {
    ...actual,
    buildCompanyStoreBlobUrl: vi.fn(
      (path: string) =>
        `https://github.com/aharonyaircohen/kody-company-store/blob/stable/${path}`,
    ),
    companyStoreUpdatedAt: vi.fn(async () => "2026-06-24T00:00:00.000Z"),
    listCompanyStoreMarkdownAssetSlugs: vi.fn(async () => [
      "factory",
      "review",
    ]),
    readCompanyStoreText: vi.fn(async (_octokit: unknown, path: string) => {
      if (path === ".kody/commands/factory.md") {
        return [
          "---",
          "description: Create a Kody model bundle",
          "argumentHint: <request>",
          "---",
          "Factory request: $ARGUMENTS",
          "",
        ].join("\n");
      }
      if (path === ".kody/commands/review.md") {
        return [
          "---",
          "description: Store review",
          "---",
          "Store review body",
          "",
        ].join("\n");
      }
      return null;
    }),
  };
});

import { listCommands, readResolvedCommandFile } from "@dashboard/lib/commands";

function repoCommandContent(body: string): string {
  return Buffer.from(
    ["---", "description: Repo review", "---", body, ""].join("\n"),
    "utf-8",
  ).toString("base64");
}

describe("Store command resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCommits.mockResolvedValue({ data: [] });
    getContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path === ".kody/commands") {
        return {
          data: [{ name: "review.md", sha: "repo-review-sha", type: "file" }],
        };
      }
      if (path === ".kody/commands/review.md") {
        return {
          data: {
            content: repoCommandContent("Repo review body"),
            sha: "repo-review-sha",
          },
        };
      }
      const error = new Error("not found") as Error & { status?: number };
      error.status = 404;
      throw error;
    });
  });

  it("loads active Store commands between repo overrides and built-ins", async () => {
    const commands = await listCommands({
      activeStoreSlugs: new Set(["factory"]),
    });

    const factory = commands.find((command) => command.slug === "factory");
    const review = commands.find((command) => command.slug === "review");
    const plan = commands.find((command) => command.slug === "plan");

    expect(factory).toMatchObject({
      slug: "factory",
      source: "store",
      body: "Factory request: $ARGUMENTS\n",
    });
    expect(review).toMatchObject({
      slug: "review",
      source: "repo",
      body: "Repo review body\n",
    });
    expect(plan).toMatchObject({
      slug: "plan",
      source: "builtin",
    });
  });

  it("only loads active Store commands when an active set is provided", async () => {
    const inactiveCommands = await listCommands({
      activeStoreSlugs: new Set(),
    });
    expect(inactiveCommands.find((command) => command.slug === "factory")).toBe(
      undefined,
    );
    expect(
      inactiveCommands.find((command) => command.slug === "plan"),
    ).toMatchObject({
      slug: "plan",
      source: "builtin",
    });

    const activeCommands = await listCommands({
      activeStoreSlugs: new Set(["factory"]),
    });
    expect(
      activeCommands.find((command) => command.slug === "factory"),
    ).toMatchObject({
      slug: "factory",
      source: "store",
    });
  });

  it("reads resolved Store command when no repo command exists", async () => {
    const command = await readResolvedCommandFile("factory");

    expect(command).toMatchObject({
      slug: "factory",
      source: "store",
      argumentHint: "<request>",
    });
  });
});
