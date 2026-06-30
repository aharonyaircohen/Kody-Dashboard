import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { CmsAdapterContext } from "@dashboard/lib/cms/adapters";
import type { CmsRuntimeConfig } from "@dashboard/lib/cms/types";

describe("CMS adapter boundary", () => {
  it("keeps Dashboard runtime adapters generic", () => {
    const adapterRoot = path.join(
      process.cwd(),
      "src/dashboard/lib/cms/adapters",
    );
    const files = listFiles(adapterRoot)
      .map((file) => path.relative(adapterRoot, file))
      .sort();
    const source = files
      .map((file) => readFileSync(path.join(adapterRoot, file), "utf8"))
      .join("\n");

    expect(files).not.toEqual(
      expect.arrayContaining(["github.ts", "mongodb.ts", "mongodb-schema.ts"]),
    );
    expect(source).not.toMatch(/from\s+["']mongodb["']/);
    expect(source).not.toMatch(/MongoClient|ObjectId/);
    expect(source).not.toMatch(/["']\.\/mongodb["']/);
  });

  it("anchors remote adapter package dependencies outside adapter code", () => {
    const bridgeSource = readFileSync(
      path.join(process.cwd(), "src/dashboard/lib/cms/adapters/index.ts"),
      "utf8",
    );
    const depsSource = readFileSync(
      path.join(process.cwd(), "src/dashboard/lib/cms/runtime-deps.ts"),
      "utf8",
    );

    expect(bridgeSource).toMatch(/import\s+["']\.\.\/runtime-deps["']/);
    expect(depsSource).toMatch(/import\s+["']mongodb["']/);
  });

  it("loads a Store-owned adapter through the generic bridge", async () => {
    const root = path.join(tmpdir(), `kody-cms-adapters-${Date.now()}`);
    const adapterDir = path.join(root, "example");
    mkdirSync(adapterDir, { recursive: true });
    writeFileSync(
      path.join(adapterDir, "index.mjs"),
      `
        export function createCmsAdapter(options) {
          return {
            async list(collectionName, query) {
              const { octokit: _octokit, ...state } = await options.getStateRepository()
              return {
                docs: [{
                  collectionName,
                  query,
                  mode: options.settings.mode,
                  secret: await options.getSecret("EXAMPLE_SECRET"),
                  state
                }],
                total: 1,
                limit: query?.limit ?? 50,
                offset: 0
              }
            },
            async get(collectionName, id) {
              return { id, collectionName }
            },
            async create(collectionName, data) {
              return { ...data, collectionName }
            },
            async update(collectionName, id, data) {
              return { id, ...data, collectionName }
            },
            async delete() {
              return { deleted: true }
            }
          }
        }
      `,
    );

    const previousRoot = process.env.KODY_CMS_ADAPTERS_ROOT;
    process.env.KODY_CMS_ADAPTERS_ROOT = root;
    try {
      const { getCmsAdapter } = await import("@dashboard/lib/cms/adapters");
      const adapter = getCmsAdapter("example");

      expect(adapter).not.toBeNull();
      await expect(adapter?.list(testContext(), { limit: 2 })).resolves.toEqual(
        {
          docs: [
            {
              collectionName: "lessons",
              query: { limit: 2 },
              mode: "test",
              secret: "secret-value",
              state: {
                owner: "A-Guy-educ",
                repo: "kody-state",
                branch: "main",
                basePath: "A-Guy-Web",
              },
            },
          ],
          total: 1,
          limit: 2,
          offset: 0,
        },
      );
      await expect(adapter?.delete(testContext(), "1")).resolves.toBe(true);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.KODY_CMS_ADAPTERS_ROOT;
      } else {
        process.env.KODY_CMS_ADAPTERS_ROOT = previousRoot;
      }
    }
  });

  it("loads adapters from the Dashboard-selected Store target", async () => {
    const adapterName = `remote_example_${Date.now()}`;
    const octokit = new FakeStoreOctokit({
      [`cms/adapters/${adapterName}/index.mjs`]: `
        export function createCmsAdapter(options) {
          return {
            async list(collectionName, query) {
              return {
                docs: [{
                  collectionName,
                  query,
                  mode: options.settings.mode
                }],
                total: 1,
                limit: query?.limit ?? 50,
                offset: 0
              }
            },
            async get(collectionName, id) {
              return { id, collectionName }
            },
            async create(collectionName, data) {
              return { ...data, collectionName }
            },
            async update(collectionName, id, data) {
              return { id, ...data, collectionName }
            },
            async delete() {
              return { deleted: true }
            }
          }
        }
      `,
      "cms/contract/index.mjs": "export const contractLoaded = true\n",
    });

    const previousRoot = process.env.KODY_CMS_ADAPTERS_ROOT;
    const previousStoreRoot = process.env.KODY_STORE_ROOT;
    delete process.env.KODY_CMS_ADAPTERS_ROOT;
    delete process.env.KODY_STORE_ROOT;
    try {
      const { getCmsAdapter } = await import("@dashboard/lib/cms/adapters");
      const adapter = getCmsAdapter(adapterName);

      await expect(
        adapter?.list(
          testContext({
            adapterName,
            store: {
              octokit: octokit as never,
              repoUrl: "https://github.com/acme/kody-company-store",
              ref: "stable",
            },
          }),
          { limit: 3 },
        ),
      ).resolves.toEqual({
        docs: [
          {
            collectionName: "lessons",
            query: { limit: 3 },
            mode: "test",
          },
        ],
        total: 1,
        limit: 3,
        offset: 0,
      });
      expect(octokit.reads).toEqual([
        "acme/kody-company-store/stable/cms/adapters/" +
          `${adapterName}/index.mjs`,
        "acme/kody-company-store/stable/cms/contract/index.mjs",
      ]);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.KODY_CMS_ADAPTERS_ROOT;
      } else {
        process.env.KODY_CMS_ADAPTERS_ROOT = previousRoot;
      }
      if (previousStoreRoot === undefined) {
        delete process.env.KODY_STORE_ROOT;
      } else {
        process.env.KODY_STORE_ROOT = previousStoreRoot;
      }
    }
  });
});

function testContext(
  options: {
    adapterName?: string;
    store?: CmsAdapterContext["store"];
  } = {},
): CmsAdapterContext {
  const adapterName = options.adapterName ?? "example";
  const config: CmsRuntimeConfig = {
    version: 1,
    name: "Example CMS",
    environment: "test",
    defaultAdapter: adapterName,
    writePolicy: "enabled",
    adapters: {
      [adapterName]: { mode: "test" },
    },
    permissions: {
      content: {},
      schema: {},
    },
    collections: {
      lessons: {
        name: "lessons",
        label: "Lessons",
        adapter: adapterName,
        writePolicy: "enabled",
        permissions: {},
        source: { collection: "lessons", idField: "_id" },
        titleField: "title",
        searchFields: ["title"],
        operations: {
          list: true,
          get: true,
          search: true,
          create: true,
          update: true,
          delete: true,
        },
        defaultSort: [],
        fields: [
          { name: "_id", type: "id", label: "ID", readOnly: true },
          { name: "title", type: "text", label: "Title" },
        ],
        filters: [],
      },
    },
  };

  return {
    config,
    collection: config.collections.lessons,
    settings: config.adapters[adapterName],
    store: options.store,
    getSecret: async (name) =>
      name === "EXAMPLE_SECRET" ? "secret-value" : null,
    getStateRepository: async () => ({
      octokit: {} as never,
      owner: "A-Guy-educ",
      repo: "kody-state",
      branch: "main",
      basePath: "A-Guy-Web",
    }),
  };
}

class FakeStoreOctokit {
  readonly reads: string[] = [];
  readonly files: Map<string, string>;

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
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
      this.reads.push(key);
      const content = this.files.get(path);
      if (!content)
        throw Object.assign(new Error("not found"), { status: 404 });
      return {
        data: {
          type: "file",
          content: Buffer.from(content, "utf8").toString("base64"),
          encoding: "base64",
          sha: `${path}-sha`,
        },
      };
    },
  };
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".ts") ? [absolute] : [];
  });
}
