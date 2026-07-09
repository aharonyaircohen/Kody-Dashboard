import { describe, expect, it, vi } from "vitest";

import {
  createGitHubStorageAdapter,
  createGitHubStorageFetchClient,
} from "@dashboard/lib/storage/github";

describe("GitHub storage adapter", () => {
  it("reads, lists, writes, and deletes text files through one storage contract", async () => {
    const octokit = new FakeOctokit();
    const adapter = createGitHubStorageAdapter(octokit as never);
    const target = { owner: "acme", repo: "state", ref: "main" };

    octokit.seedText(target, "memory/intro.md", "# Intro\n");

    await expect(adapter.readText(target, "memory/intro.md")).resolves.toEqual(
      expect.objectContaining({
        path: "memory/intro.md",
        content: "# Intro\n",
        version: "memory/intro.md-sha",
      }),
    );
    await expect(adapter.list(target, "memory")).resolves.toMatchObject({
      entries: [{ name: "intro.md", path: "memory/intro.md", type: "file" }],
      path: "memory",
    });

    await expect(
      adapter.writeText({
        target,
        path: "memory/next.md",
        content: "# Next\n",
        message: "write next",
      }),
    ).resolves.toMatchObject({
      path: "memory/next.md",
      version: "sha-next",
    });

    await adapter.deleteFile({
      target,
      path: "memory/next.md",
      version: "sha-next",
      message: "delete next",
    });

    await expect(
      adapter.readText(target, "memory/next.md"),
    ).resolves.toBeNull();
  });

  it("commits multiple text files and directory deletions through git tree operations", async () => {
    const octokit = new FakeOctokit();
    const adapter = createGitHubStorageAdapter(octokit as never);
    const target = { owner: "acme", repo: "state", ref: "main" };

    await expect(
      adapter.writeTextFiles({
        target,
        files: [
          { path: "cms/config.json", content: "{}\n" },
          { path: "cms/collections/articles.json", content: "[]\n" },
        ],
        message: "write cms",
      }),
    ).resolves.toEqual({ version: "commit-1" });

    expect(octokit.createdTrees[0]?.tree).toEqual([
      {
        path: "cms/config.json",
        mode: "100644",
        type: "blob",
        content: "{}\n",
      },
      {
        path: "cms/collections/articles.json",
        mode: "100644",
        type: "blob",
        content: "[]\n",
      },
    ]);

    octokit.seedText(target, "cms/config.json", "{}\n");
    octokit.seedText(target, "cms/collections/articles.json", "[]\n");

    await expect(
      adapter.deleteDirectory({
        target,
        path: "cms",
        message: "delete cms",
      }),
    ).resolves.toEqual({ deleted: 2 });

    expect(octokit.createdTrees[1]?.tree).toEqual([
      {
        path: "cms/config.json",
        mode: "100644",
        type: "blob",
        sha: null,
      },
      {
        path: "cms/collections/articles.json",
        mode: "100644",
        type: "blob",
        sha: null,
      },
    ]);
  });

  it("reads public contents through the fetch-backed GitHub client", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          type: "file",
          content: Buffer.from("vault-payload\n", "utf8").toString("base64"),
          encoding: "base64",
          sha: "vault-sha",
          html_url: "https://github.test/widgets/secrets.enc",
          size: 14,
        }),
        { headers: { etag: '"vault-sha"' } },
      );
    });
    const adapter = createGitHubStorageAdapter(
      createGitHubStorageFetchClient(fetchImpl),
    );

    await expect(
      adapter.readText(
        { owner: "acme", repo: "kody-state" },
        "widgets/secrets.enc",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        path: "widgets/secrets.enc",
        content: "vault-payload\n",
        version: "vault-sha",
        etag: '"vault-sha"',
      }),
    );

    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/acme/kody-state/contents/widgets/secrets.enc",
    ]);
  });

  it("keeps optional refs explicit for fetch-backed reads", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          type: "file",
          content: Buffer.from("content", "utf8").toString("base64"),
          encoding: "base64",
          sha: "sha",
        }),
      );
    });
    const adapter = createGitHubStorageAdapter(
      createGitHubStorageFetchClient(fetchImpl),
    );

    await adapter.readText(
      { owner: "acme", repo: "kody-state", ref: "state/main" },
      "widgets/secrets.enc",
    );

    const url = new URL(requestedUrls[0] ?? "");
    expect(url.searchParams.get("ref")).toBe("state/main");
  });

  it("returns null for missing fetch-backed contents", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 }));
    const adapter = createGitHubStorageAdapter(
      createGitHubStorageFetchClient(fetchImpl),
    );

    await expect(
      adapter.readText(
        { owner: "acme", repo: "kody-state" },
        "widgets/secrets.enc",
      ),
    ).resolves.toBeNull();
  });
});

type Target = { owner: string; repo: string; ref: string };

class FakeOctokit {
  files = new Map<string, { content: string; sha: string }>();
  createdTrees: Array<{ tree: unknown[] }> = [];
  headSha = "head-1";
  treeSha = "tree-1";

  seedText(target: Target, path: string, content: string): void {
    this.files.set(this.key(target, path), {
      content: Buffer.from(content, "utf8").toString("base64"),
      sha: `${path}-sha`,
    });
  }

  repos = {
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
            path,
            name: path.split("/").at(-1),
            content: file.content,
            encoding: "base64",
            sha: file.sha,
            html_url: `https://github.test/${path}`,
            size: Buffer.from(file.content, "base64").length,
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
            html_url: `https://github.test/${entryPath}`,
            size: 1,
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
      const target = {
        owner: input.owner,
        repo: input.repo,
        ref: input.branch ?? "main",
      };
      this.files.set(this.key(target, input.path), {
        content: input.content,
        sha: "sha-next",
      });
      return {
        data: {
          content: {
            sha: "sha-next",
            html_url: `https://github.test/${input.path}`,
          },
          commit: { sha: "commit-next" },
        },
      };
    },
    deleteFile: async (input: {
      owner: string;
      repo: string;
      path: string;
      branch?: string;
    }) => {
      this.files.delete(
        this.key(
          { owner: input.owner, repo: input.repo, ref: input.branch ?? "main" },
          input.path,
        ),
      );
      return { data: {} };
    },
  };

  git = {
    getRef: async () => ({ data: { object: { sha: this.headSha } } }),
    getCommit: async () => ({ data: { tree: { sha: this.treeSha } } }),
    createTree: async ({ tree }: { tree: unknown[] }) => {
      this.createdTrees.push({ tree });
      return { data: { sha: `tree-${this.createdTrees.length + 1}` } };
    },
    createCommit: async () => ({
      data: { sha: `commit-${this.createdTrees.length}` },
    }),
    updateRef: async () => ({ data: {} }),
    getTree: async () => ({
      data: {
        truncated: false,
        tree: [...this.files.keys()].map((fileKey) => ({
          path: fileKey.split("/").slice(3).join("/"),
          type: "blob",
        })),
      },
    }),
    createBlob: async ({ content }: { content: string }) => ({
      data: { sha: `blob-${content.length}` },
    }),
  };

  private key(target: Target, path: string): string {
    return `${target.owner}/${target.repo}/${target.ref}/${path}`;
  }
}
