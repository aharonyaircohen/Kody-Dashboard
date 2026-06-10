import { describe, expect, it } from "vitest";
import { isAllowedDocPath, listDocs } from "@dashboard/lib/docs/file";
import {
  buildDocTree,
  firstDocFilePath,
} from "@dashboard/lib/components/DocsView";
import type { DocManifestEntry } from "@dashboard/lib/api";

describe("docs path guard", () => {
  it("allows README and nested docs markdown files", () => {
    expect(isAllowedDocPath("README.md")).toBe(true);
    expect(isAllowedDocPath("docs/guide.md")).toBe(true);
    expect(isAllowedDocPath("docs/nested/guide.md")).toBe(true);

    expect(isAllowedDocPath(".env")).toBe(false);
    expect(isAllowedDocPath("docs/../.env")).toBe(false);
    expect(isAllowedDocPath("/etc/passwd")).toBe(false);
    expect(isAllowedDocPath("src/app.ts")).toBe(false);
    expect(isAllowedDocPath("docs/nested")).toBe(false);
    expect(isAllowedDocPath("docs/nested/guide.txt")).toBe(false);
  });
});

describe("docs manifest", () => {
  it("walks docs folders and includes nested markdown files", async () => {
    const octokit = {
      rest: {
        repos: {
          getContent: async ({ path }: { path: string }) => {
            if (path === "README.md") {
              return {
                data: {
                  type: "file",
                  name: "README.md",
                  path: "README.md",
                  html_url: "https://example.com/readme",
                },
              };
            }
            if (path === "docs") {
              return {
                data: [
                  {
                    type: "file",
                    name: "intro.md",
                    path: "docs/intro.md",
                    html_url: "https://example.com/intro",
                  },
                  {
                    type: "file",
                    name: "notes.txt",
                    path: "docs/notes.txt",
                    html_url: "https://example.com/notes",
                  },
                  {
                    type: "dir",
                    name: "guides",
                    path: "docs/guides",
                    html_url: "https://example.com/guides",
                  },
                ],
              };
            }
            if (path === "docs/guides") {
              return {
                data: [
                  {
                    type: "file",
                    name: "setup.md",
                    path: "docs/guides/setup.md",
                    html_url: "https://example.com/setup",
                  },
                ],
              };
            }
            throw Object.assign(new Error("not found"), { status: 404 });
          },
        },
      },
    };

    const manifest = await listDocs(octokit as never, "owner", "repo");

    expect(manifest.files.map((file) => `${file.type}:${file.path}`)).toEqual([
      "file:README.md",
      "folder:docs",
      "folder:docs/guides",
      "file:docs/guides/setup.md",
      "file:docs/intro.md",
    ]);
  });
});

describe("docs tree", () => {
  it("builds folders around nested doc files", () => {
    const files: DocManifestEntry[] = [
      {
        name: "README.md",
        path: "README.md",
        type: "file",
        htmlUrl: null,
      },
      { name: "docs", path: "docs", type: "folder", htmlUrl: null },
      {
        name: "architecture",
        path: "docs/architecture",
        type: "folder",
        htmlUrl: null,
      },
      {
        name: "state.md",
        path: "docs/architecture/state.md",
        type: "file",
        htmlUrl: null,
      },
      {
        name: "guide.md",
        path: "docs/guide.md",
        type: "file",
        htmlUrl: null,
      },
    ];

    const tree = buildDocTree(files);

    expect(tree.map((node) => node.entry.path)).toEqual(["README.md", "docs"]);
    const docs = tree.find((node) => node.entry.path === "docs")!;
    expect(docs.children.map((node) => node.entry.path)).toEqual([
      "docs/architecture",
      "docs/guide.md",
    ]);
    expect(docs.children[0]!.children.map((node) => node.entry.path)).toEqual([
      "docs/architecture/state.md",
    ]);
    expect(firstDocFilePath(files)).toBe("README.md");
  });
});
