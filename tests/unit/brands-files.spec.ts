import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getOctokit: vi.fn(),
  getOwner: vi.fn(),
  getRepo: vi.fn(),
  invalidateBrandsCache: vi.fn(),
  listStateDirectory: vi.fn(),
  readStateText: vi.fn(),
  writeStateText: vi.fn(),
  deleteStateFile: vi.fn(),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: h.getOctokit,
  getOwner: h.getOwner,
  getRepo: h.getRepo,
  invalidateBrandsCache: h.invalidateBrandsCache,
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  listStateDirectory: h.listStateDirectory,
  readStateText: h.readStateText,
  writeStateText: h.writeStateText,
  deleteStateFile: h.deleteStateFile,
}));

import {
  disableBrand,
  deleteBrandFile,
  findBrandFileFromList,
  listBrandFiles,
  readBrandFile,
  writeBrandFile,
} from "@dashboard/lib/brands/files";

describe("brand files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getOctokit.mockReturnValue({ rest: {} });
    h.getOwner.mockReturnValue("acme");
    h.getRepo.mockReturnValue("widgets");
    h.listStateDirectory.mockResolvedValue({
      entries: [],
      targetPath: "widgets/brands",
    });
    h.readStateText.mockResolvedValue(null);
    h.writeStateText.mockResolvedValue({
      sha: "new-sha",
      path: "widgets/brands/acme.json",
      htmlUrl: "https://github.test/acme",
    });
  });

  it("lists valid brand json files from the state repo", async () => {
    h.listStateDirectory.mockResolvedValue({
      entries: [
        { name: "listbrand.json", type: "file" },
        { name: "README.md", type: "file" },
        { name: "_hidden.json", type: "file" },
      ],
    });
    h.readStateText.mockResolvedValue({
      content: JSON.stringify({
        slug: "List Brand",
        name: "List Brand",
        accent: "#2563eb",
        locale: "HE_IL",
      }),
      sha: "sha",
      htmlUrl: "https://github.test/acme",
    });

    await expect(listBrandFiles()).resolves.toEqual([
      expect.objectContaining({
        slug: "list-brand",
        name: "List Brand",
        accent: "#2563eb",
        locale: "he-il",
        source: "repo",
      }),
    ]);
  });

  it("uses the cached brand list before probing a random slug", async () => {
    h.getRepo.mockReturnValue("random-budget");
    h.listStateDirectory.mockResolvedValue({
      entries: [],
      targetPath: "random-budget/brands",
      etag: "list-etag",
    });

    await expect(findBrandFileFromList("random-one")).resolves.toBeNull();
    await expect(findBrandFileFromList("random-two")).resolves.toBeNull();

    expect(h.listStateDirectory).toHaveBeenCalledTimes(2);
    expect(h.readStateText).not.toHaveBeenCalled();
  });

  it("rejects invalid brand file content", async () => {
    h.readStateText.mockResolvedValue({
      content: JSON.stringify({
        slug: "invalid",
        name: "Acme",
        accent: "blue",
      }),
      sha: "sha",
      htmlUrl: "",
    });

    await expect(readBrandFile("invalid")).rejects.toThrow(
      "Invalid brand file",
    );
  });

  it("writes normalized brand JSON and invalidates brand cache", async () => {
    h.readStateText.mockImplementation((_octokit, _owner, _repo, path) => {
      if (path === "brands/write-brand.disabled") return Promise.resolve(null);
      return Promise.resolve({
        content: JSON.stringify({
          slug: "write-brand",
          name: "Write Brand",
          accent: "#2563eb",
        }),
        sha: "new-sha",
        htmlUrl: "https://github.test/writebrand",
      });
    });

    await writeBrandFile({
      octokit: { rest: {} } as never,
      slug: " Write Brand ",
      name: " Write Brand ",
      accent: "#2563EB",
      locale: "HE_IL",
      welcomeText: "",
      modelId: "sonnet-4",
      agentSlug: "qa_agent",
    });

    expect(h.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        path: "brands/write-brand.json",
        content: `${JSON.stringify(
          {
            slug: "write-brand",
            name: "Write Brand",
            accent: "#2563eb",
            locale: "he-il",
            modelId: "sonnet-4",
            agentSlug: "qa_agent",
          },
          null,
          2,
        )}\n`,
      }),
    );
    expect(h.invalidateBrandsCache).toHaveBeenCalledWith("write-brand");
  });

  it("does not list brands with a repo-level disabled marker", async () => {
    h.listStateDirectory.mockResolvedValue({
      entries: [
        { name: "acme.json", type: "file" },
        { name: "acme.disabled", type: "file" },
      ],
    });
    h.readStateText.mockResolvedValue({
      content: JSON.stringify({
        slug: "acme",
        name: "Acme",
        accent: "#2563eb",
      }),
      sha: "sha",
      htmlUrl: "https://github.test/acme",
    });

    await expect(listBrandFiles()).resolves.toEqual([]);
  });

  it("deletes an existing brand file", async () => {
    h.readStateText.mockResolvedValue({
      content: JSON.stringify({
        slug: "deletebrand",
        name: "Delete Brand",
        accent: "#2563eb",
      }),
      sha: "sha",
      htmlUrl: "",
    });

    await deleteBrandFile({ rest: {} } as never, "deletebrand");

    expect(h.deleteStateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "brands/deletebrand.json",
        sha: "sha",
      }),
    );
    expect(h.invalidateBrandsCache).toHaveBeenCalledWith("deletebrand");
  });

  it("writes a disabled marker for a deleted fallback brand", async () => {
    h.readStateText.mockResolvedValue(null);

    await disableBrand({ rest: {} } as never, "Acme");

    expect(h.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "brands/acme.disabled",
        content: "acme\n",
      }),
    );
    expect(h.invalidateBrandsCache).toHaveBeenCalledWith("acme");
  });
});
