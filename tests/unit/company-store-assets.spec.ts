import { describe, expect, it } from "vitest";
import {
  companyStoreAssetPath,
  companyStoreUpdatedAt,
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

  it("lists markdown-backed store agents from the configured root-layout folder", async () => {
    const paths: string[] = [];
    const octokit = {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          paths.push(path);
          if (path === "kody-store.json") {
            return {
              data: {
                content: Buffer.from(
                  JSON.stringify({
                    assetRoots: { agent: "agents", commands: "commands" },
                  }),
                  "utf8",
                ).toString("base64"),
              },
            };
          }
          return {
            data: [
              { name: "cto.md", type: "file" },
              { name: "release-manager.md", type: "file" },
              { name: "_draft.md", type: "file" },
              { name: "notes.txt", type: "file" },
              { name: "nested", type: "dir" },
            ],
          };
        },
      },
    };

    await expect(
      listCompanyStoreMarkdownAssetSlugs(octokit as never, "agents", (slug) =>
        /^[a-z0-9][a-z0-9_-]*$/.test(slug),
      ),
    ).resolves.toEqual(["cto", "release-manager"]);
    expect(paths).toEqual(["kody-store.json", "agents"]);
  });

  it("builds Store asset paths from the configured Store ref layout", async () => {
    const octokit = {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          return {
            data: {
              content: Buffer.from(
                JSON.stringify({ assetRoots: { commands: "commands" } }),
                "utf8",
              ).toString("base64"),
            },
          };
        },
      },
    };

    await expect(
      companyStoreAssetPath(octokit as never, "commands", "review.md"),
    ).resolves.toBe("commands/review.md");
  });

  it("reads plural agent mtimes from legacy singular manifest key", async () => {
    const octokit = {
      repos: {
        getContent: async () => ({
          data: {
            content: Buffer.from(
              JSON.stringify({
                kinds: {
                  agent: {
                    selected: {
                      cto: { mtime: "2026-06-22T12:00:00.000Z" },
                    },
                  },
                },
              }),
              "utf-8",
            ).toString("base64"),
          },
        }),
      },
    };

    await expect(
      companyStoreUpdatedAt(octokit as never, "agents", "cto"),
    ).resolves.toBe("2026-06-22T12:00:00.000Z");
  });
});
