import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stateRepo = vi.hoisted(() => ({
  readStateText: vi.fn(),
  resolveStateRepo: vi.fn(async () => ({
    owner: "A-Guy-educ",
    repo: "kody-state",
    basePath: "A-Guy-Web",
  })),
}));

const roles = vi.hoisted(() => ({
  getCmsActorRole: vi.fn(async () => "admin"),
}));

const vault = vi.hoisted(() => ({
  getSecret: vi.fn(async () => null),
}));

vi.mock("@dashboard/lib/state-repo", () => stateRepo);
vi.mock("@dashboard/lib/cms/roles", () => roles);
vi.mock("@dashboard/lib/vault/get-secret", () => vault);

import {
  createCmsDocument,
  deleteCmsDocument,
  getCmsDocument,
  listCmsDocuments,
  updateCmsDocument,
} from "@dashboard/lib/cms/service";
import { invalidateCmsConfigCache } from "@dashboard/lib/cms/config";

describe("CMS service GitHub adapter integration", () => {
  let octokit: FakeOctokit;
  let previousAdapterRoot: string | undefined;
  let previousStoreRoot: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCmsConfigCache();
    octokit = new FakeOctokit();
    octokit.seedText(
      "aharonyaircohen",
      "kody-company-store",
      "stable",
      "cms/adapters/github/index.mjs",
      readStoreFile("cms/adapters/github/index.mjs"),
    );
    octokit.seedText(
      "aharonyaircohen",
      "kody-company-store",
      "stable",
      "cms/contract/index.mjs",
      readStoreFile("cms/contract/index.mjs"),
    );
    previousAdapterRoot = process.env.KODY_CMS_ADAPTERS_ROOT;
    previousStoreRoot = process.env.KODY_STORE_ROOT;
    delete process.env.KODY_CMS_ADAPTERS_ROOT;
    delete process.env.KODY_STORE_ROOT;
    stateRepo.readStateText.mockImplementation(async (_octokit, _owner, _repo, filePath) => {
      const content = stateFiles[String(filePath)];
      return content
        ? { path: String(filePath), content, sha: `${filePath}-sha` }
        : null;
    });
  });

  afterEach(() => {
    if (previousAdapterRoot === undefined) {
      delete process.env.KODY_CMS_ADAPTERS_ROOT;
    } else {
      process.env.KODY_CMS_ADAPTERS_ROOT = previousAdapterRoot;
    }
    if (previousStoreRoot === undefined) {
      delete process.env.KODY_STORE_ROOT;
    } else {
      process.env.KODY_STORE_ROOT = previousStoreRoot;
    }
  });

  it("creates missing GitHub-backed schema paths through the Store adapter", async () => {
    const req = request();

    await expect(
      listCmsDocuments(req, octokit as never, "A-Guy-educ", "A-Guy-Web", "articles", {}),
    ).resolves.toMatchObject({ docs: [], total: 0 });

    const created = await createCmsDocument(
      req,
      octokit as never,
      "A-Guy-educ",
      "A-Guy-Web",
      "articles",
      { id: "intro", title: "Intro", status: "draft" },
    );

    expect(created).toEqual({ id: "intro", title: "Intro", status: "draft" });
    expect(octokit.writes[0]).toMatchObject({
      owner: "A-Guy-educ",
      repo: "kody-state",
      path: "A-Guy-Web/content/articles/intro.json",
      branch: "kody-state",
      message: "cms: create articles/intro",
    });

    await expect(
      getCmsDocument(req, octokit as never, "A-Guy-educ", "A-Guy-Web", "articles", "intro"),
    ).resolves.toEqual({ id: "intro", title: "Intro", status: "draft" });

    await expect(
      listCmsDocuments(req, octokit as never, "A-Guy-educ", "A-Guy-Web", "articles", {
        search: { query: "intro" },
      }),
    ).resolves.toMatchObject({
      docs: [{ id: "intro", title: "Intro" }],
      total: 1,
    });
  });

  it("updates and deletes GitHub-backed documents through Dashboard service", async () => {
    const req = request();
    await createCmsDocument(req, octokit as never, "A-Guy-educ", "A-Guy-Web", "articles", {
      id: "intro",
      title: "Intro",
      status: "draft",
    });

    await expect(
      updateCmsDocument(
        req,
        octokit as never,
        "A-Guy-educ",
        "A-Guy-Web",
        "articles",
        "intro",
        { status: "published" },
      ),
    ).resolves.toEqual({ id: "intro", title: "Intro", status: "published" });

    await expect(
      deleteCmsDocument(req, octokit as never, "A-Guy-educ", "A-Guy-Web", "articles", "intro"),
    ).resolves.toBe(true);
    await expect(
      getCmsDocument(req, octokit as never, "A-Guy-educ", "A-Guy-Web", "articles", "intro"),
    ).resolves.toBeNull();
  });
});

const stateFiles: Record<string, string> = {
  "cms/config.json": JSON.stringify({
    version: 1,
    name: "GitHub CMS",
    environment: "default",
    defaultAdapter: "github",
    writePolicy: "enabled",
    collections: ["collections/articles.json"],
  }),
  "cms/collections/articles.json": JSON.stringify({
    name: "articles",
    label: "Articles",
    adapter: "github",
    source: { path: "content/articles", idField: "id", extension: "json" },
    titleField: "title",
    searchFields: ["title"],
    writePolicy: "enabled",
    operations: {
      list: true,
      get: true,
      search: true,
      create: true,
      update: true,
      delete: true,
    },
    fields: [
      { name: "id", type: "id", readOnly: true },
      { name: "title", type: "text", required: true },
      { name: "status", type: "select", options: ["draft", "published"] },
    ],
    filters: [{ field: "status", operators: ["equals"] }],
  }),
};

function request() {
  return new NextRequest("https://dash.test/api/kody/cms", {
    headers: {
      "x-kody-token": "ghp_test",
      "x-kody-owner": "A-Guy-educ",
      "x-kody-repo": "A-Guy-Web",
      "x-kody-store-repo-url":
        "https://github.com/aharonyaircohen/kody-company-store",
      "x-kody-store-ref": "stable",
    },
  });
}

function readStoreFile(filePath: string): string {
  return readFileSync(path.resolve(process.cwd(), "../kody-store", filePath), "utf8");
}

class FakeOctokit {
  files = new Map<string, { content: string; sha: string }>();
  writes: Array<Record<string, unknown>> = [];
  seedText(
    owner: string,
    repo: string,
    ref: string,
    filePath: string,
    content: string,
  ) {
    this.files.set(`${owner}/${repo}/${ref}/${filePath}`, {
      content: Buffer.from(content, "utf8").toString("base64"),
      sha: `${filePath}-sha`,
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
      const key = `${owner}/${repo}/${ref}/${path}`;
      const file = this.files.get(key);
      if (file) {
        return {
          data: {
            type: "file",
            content: file.content,
            encoding: "base64",
            sha: file.sha,
          },
        };
      }
      const prefix = `${key.replace(/\/+$/g, "")}/`;
      const entries = [...this.files.keys()]
        .filter((fileKey) => fileKey.startsWith(prefix))
        .map((fileKey) => ({
          type: "file",
          path: fileKey.slice(`${owner}/${repo}/${ref}/`.length),
        }));
      if (entries.length > 0) return { data: entries };
      throw Object.assign(new Error("not found"), { status: 404 });
    },
    createOrUpdateFileContents: async (input: {
      owner: string;
      repo: string;
      path: string;
      branch: string;
      content: string;
    }) => {
      this.writes.push(input);
      this.files.set(`${input.owner}/${input.repo}/${input.branch}/${input.path}`, {
        content: input.content,
        sha: "sha-next",
      });
      return { data: { content: { sha: "sha-next" } } };
    },
    deleteFile: async (input: {
      owner: string;
      repo: string;
      path: string;
      branch: string;
    }) => {
      this.files.delete(`${input.owner}/${input.repo}/${input.branch}/${input.path}`);
      return { data: {} };
    },
  };
}
