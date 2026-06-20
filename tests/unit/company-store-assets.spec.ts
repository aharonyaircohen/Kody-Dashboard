import { describe, expect, it } from "vitest";

import {
  listCompanyStoreMarkdownAssetSlugs,
  mergeAssetsBySlug,
} from "../../src/dashboard/lib/company-store/assets";

describe("company store asset merge", () => {
  it("keeps local assets first and adds store-only assets", () => {
    const merged = mergeAssetsBySlug(
      [
        { slug: "fix", source: "local" },
        { slug: "release", source: "local" },
      ],
      [
        { slug: "release", source: "store" },
        { slug: "sync", source: "store" },
      ],
    );

    expect(merged).toEqual([
      { slug: "fix", source: "local" },
      { slug: "release", source: "local" },
      { slug: "sync", source: "store" },
    ]);
  });

  it("lists markdown-backed store assets for staff", async () => {
    const octokit = {
      repos: {
        getContent: async () => ({
          data: [
            { name: "cto.md", type: "file" },
            { name: "release-manager.md", type: "file" },
            { name: "_draft.md", type: "file" },
            { name: "notes.txt", type: "file" },
            { name: "nested", type: "dir" },
          ],
        }),
      },
    };

    await expect(
      listCompanyStoreMarkdownAssetSlugs(octokit as never, "staff", (slug) =>
        /^[a-z0-9][a-z0-9_-]*$/.test(slug),
      ),
    ).resolves.toEqual(["cto", "release-manager"]);
  });
});
