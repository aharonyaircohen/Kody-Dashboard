import { beforeEach, describe, expect, it, vi } from "vitest";

const engineConfig = vi.hoisted(() => ({
  getEngineConfig: vi.fn(async () => ({
    config: {
      state: {
        repo: "https://github.com/acme/kody-state",
        path: "A-Guy-Web",
        branch: "main",
      },
    },
  })),
}));

vi.mock("@dashboard/lib/engine/config", () => engineConfig);

import {
  deleteStateDirectory,
  listStateDirectory,
  readStateText,
  writeStateFiles,
  writeStateText,
} from "@dashboard/lib/state-repo";

describe("state repo storage boundary", () => {
  let octokit: FakeOctokit;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = new FakeOctokit();
  });

  it("keeps existing state repo paths while delegating through storage", async () => {
    octokit.seedText(
      { owner: "acme", repo: "kody-state", ref: "main" },
      "A-Guy-Web/memory/INDEX.md",
      "# Memory\n",
    );

    await expect(
      readStateText(
        octokit as never,
        "A-Guy-educ",
        "A-Guy-Web",
        "memory/INDEX.md",
      ),
    ).resolves.toMatchObject({
      path: "A-Guy-Web/memory/INDEX.md",
      content: "# Memory\n",
      sha: "A-Guy-Web/memory/INDEX.md-sha",
    });

    await expect(
      listStateDirectory(octokit as never, "A-Guy-educ", "A-Guy-Web", "memory"),
    ).resolves.toMatchObject({
      targetPath: "A-Guy-Web/memory",
      entries: [
        {
          name: "INDEX.md",
          path: "A-Guy-Web/memory/INDEX.md",
          type: "file",
        },
      ],
    });

    await expect(
      writeStateText({
        octokit: octokit as never,
        owner: "A-Guy-educ",
        repo: "A-Guy-Web",
        path: "memory/new.md",
        content: "# New\n",
        message: "write memory",
      }),
    ).resolves.toMatchObject({
      path: "A-Guy-Web/memory/new.md",
      sha: "sha-next",
    });
  });

  it("keeps multi-file commits and directory deletes compatible", async () => {
    await expect(
      writeStateFiles({
        octokit: octokit as never,
        owner: "A-Guy-educ",
        repo: "A-Guy-Web",
        files: [
          { path: "cms/config.json", content: "{}\n" },
          { path: "cms/collections/articles.json", content: "[]\n" },
        ],
        message: "write cms",
      }),
    ).resolves.toEqual({ sha: "commit-1" });

    expect(octokit.createdTrees[0]?.tree).toEqual([
      {
        path: "A-Guy-Web/cms/config.json",
        mode: "100644",
        type: "blob",
        content: "{}\n",
      },
      {
        path: "A-Guy-Web/cms/collections/articles.json",
        mode: "100644",
        type: "blob",
        content: "[]\n",
      },
    ]);

    await expect(
      deleteStateDirectory({
        octokit: octokit as never,
        owner: "A-Guy-educ",
        repo: "A-Guy-Web",
        path: "cms",
        message: "delete cms",
      }),
    ).resolves.toEqual({ deleted: 2 });
  });
});

type Target = { owner: string; repo: string; ref: string };

class FakeOctokit {
  files = new Map<string, { content: string; sha: string }>();
  createdTrees: Array<{ tree: unknown[] }> = [];

  seedText(target: Target, path: string, content: string): void {
    this.files.set(this.key(target, path), {
      content: Buffer.from(content, "utf8").toString("base64"),
      sha: `${path}-sha`,
    });
  }

  repos = {
    get: async () => ({ data: { default_branch: "main" } }),
    getContent: async ({
      owner,
      repo,
      path,
      ref,
    }: {
      owner: string;
      repo: string;
      path: string;
      ref?: string;
    }) => {
      const target = { owner, repo, ref: ref ?? "main" };
      const file = this.files.get(this.key(target, path));
      if (file) {
        return {
          data: {
            type: "file",
            name: path.split("/").at(-1),
            path,
            content: file.content,
            encoding: "base64",
            sha: file.sha,
          },
          headers: { etag: `"${file.sha}"` },
        };
      }
      const prefix = `${this.key(target, path).replace(/\/+$/g, "")}/`;
      const entries = [...this.files.keys()]
        .filter((fileKey) => fileKey.startsWith(prefix))
        .map((fileKey) => {
          const entryPath = fileKey.slice(
            `${target.owner}/${target.repo}/${target.ref}/`.length,
          );
          return {
            type: "file",
            name: entryPath.split("/").at(-1),
            path: entryPath,
          };
        });
      if (entries.length > 0) return { data: entries, headers: {} };
      throw Object.assign(new Error("not found"), { status: 404 });
    },
    createOrUpdateFileContents: async (input: {
      owner: string;
      repo: string;
      path: string;
      branch?: string;
      content: string;
    }) => {
      this.files.set(
        this.key(
          { owner: input.owner, repo: input.repo, ref: input.branch ?? "main" },
          input.path,
        ),
        { content: input.content, sha: "sha-next" },
      );
      return { data: { content: { sha: "sha-next" } } };
    },
  };

  git = {
    getRef: async () => ({ data: { object: { sha: "head-1" } } }),
    createRef: async () => ({ data: {} }),
    getCommit: async () => ({ data: { tree: { sha: "tree-1" } } }),
    createTree: async ({ tree }: { tree: unknown[] }) => {
      this.createdTrees.push({ tree });
      return { data: { sha: `tree-${this.createdTrees.length}` } };
    },
    createCommit: async () => ({
      data: { sha: `commit-${this.createdTrees.length}` },
    }),
    updateRef: async () => ({ data: {} }),
    getTree: async () => ({
      data: {
        truncated: false,
        tree: this.createdTrees[0]?.tree ?? [],
      },
    }),
  };

  private key(target: Target, path: string): string {
    return `${target.owner}/${target.repo}/${target.ref}/${path}`;
  }
}
