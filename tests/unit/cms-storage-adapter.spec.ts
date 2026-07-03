import { describe, expect, it } from "vitest";

import { getCmsAdapter, type CmsAdapterContext } from "@dashboard/lib/cms/adapters";
import type {
  CmsCollectionConfig,
  CmsRuntimeConfig,
} from "@dashboard/lib/cms/types";
import type { CmsStorageTransport } from "@dashboard/lib/storage";

describe("storage CMS adapter", () => {
  it("runs CMS CRUD through the storage transport only", async () => {
    const transport = new FakeCmsStorageTransport();
    const adapter = getCmsAdapter("storage");
    const context = testContext(transport);

    expect(adapter).not.toBeNull();

    await expect(
      adapter?.create(context, {
        id: "intro",
        title: "Intro",
        status: "draft",
      }),
    ).resolves.toEqual({ id: "intro", title: "Intro", status: "draft" });
    expect(transport.writes[0]).toEqual({
      path: "content/articles/intro.json",
      message: "cms: create articles/intro",
    });

    await expect(adapter?.get(context, "intro")).resolves.toEqual({
      id: "intro",
      title: "Intro",
      status: "draft",
    });

    await expect(
      adapter?.update(context, "intro", { status: "published" }),
    ).resolves.toEqual({
      id: "intro",
      title: "Intro",
      status: "published",
    });

    await expect(adapter?.delete(context, "intro")).resolves.toBe(true);
    await expect(adapter?.get(context, "intro")).resolves.toBeNull();
  });

  it("lists, filters, searches, sorts, paginates, and lists by ids", async () => {
    const transport = new FakeCmsStorageTransport();
    const adapter = getCmsAdapter("storage");
    const context = testContext(transport);

    for (const doc of [
      { id: "b", title: "Beta", status: "draft", order: 2 },
      { id: "a", title: "Alpha", status: "published", order: 1 },
      { id: "c", title: "Gamma", status: "published", order: 3 },
    ]) {
      await transport.writeFile(
        `content/articles/${doc.id}.json`,
        `${JSON.stringify(doc)}\n`,
        { message: "seed" },
      );
    }

    await expect(
      adapter?.list(context, {
        search: { query: "a", fields: ["title"] },
        filters: { status: { equals: "published" } },
        sort: [{ field: "order", direction: "desc" }],
        limit: 1,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      docs: [{ id: "c", title: "Gamma" }],
      total: 2,
      limit: 1,
      offset: 0,
    });

    await expect(adapter?.listByIds(context, ["b", "missing", "a"])).resolves.toEqual([
      { id: "b", title: "Beta", status: "draft", order: 2 },
      { id: "a", title: "Alpha", status: "published", order: 1 },
    ]);
  });

  it("does not allow id changes or unsafe storage paths", async () => {
    const transport = new FakeCmsStorageTransport();
    const adapter = getCmsAdapter("storage");
    const context = testContext(transport);

    await adapter?.create(context, {
      id: "intro",
      title: "Intro",
      status: "draft",
    });

    await expect(
      adapter?.update(context, "intro", { id: "next" }),
    ).rejects.toThrow("articles update cannot change id");

    await expect(
      adapter?.get(
        {
          ...context,
          collection: {
            ...context.collection,
            source: { path: "../outside", idField: "id", extension: "json" },
          },
        },
        "intro",
      ),
    ).rejects.toThrow("resolved storage path escapes root");
  });

  it("requires storage transport from the host", async () => {
    const adapter = getCmsAdapter("storage");

    await expect(adapter?.list(testContext(null), {})).rejects.toMatchObject({
      code: "cms_storage_unavailable",
    });
  });
});

function testContext(
  transport: CmsStorageTransport | null,
): CmsAdapterContext {
  const collection: CmsCollectionConfig = {
    name: "articles",
    label: "Articles",
    adapter: "storage",
    writePolicy: "enabled",
    permissions: {},
    source: { path: "content/articles", idField: "id", extension: "json" },
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
    defaultSort: [{ field: "title", direction: "asc" }],
    fields: [
      { name: "id", type: "id", label: "ID" },
      { name: "title", type: "text", label: "Title" },
      { name: "status", type: "select", label: "Status" },
      { name: "order", type: "number", label: "Order" },
    ],
    filters: [{ field: "status", operators: ["equals"] }],
  };
  const config: CmsRuntimeConfig = {
    version: 1,
    name: "Storage CMS",
    environment: "test",
    defaultAdapter: "storage",
    writePolicy: "enabled",
    permissions: {},
    adapters: { storage: {} },
    collections: { articles: collection },
  };
  return {
    config,
    collection,
    settings: {},
    ...(transport ? { transport } : {}),
    getSecret: async () => null,
  };
}

class FakeCmsStorageTransport implements CmsStorageTransport {
  readonly files = new Map<string, string>();
  readonly writes: Array<{ path: string; message: string }> = [];

  async listFiles(dirPath: string): Promise<string[]> {
    const prefix = dirPath.replace(/\/+$/g, "");
    return [...this.files.keys()]
      .filter((path) => path.startsWith(`${prefix}/`))
      .sort();
  }

  async readFile(filePath: string): Promise<string> {
    const file = this.files.get(filePath);
    if (file == null) {
      throw Object.assign(new Error("not a file"), { status: 404 });
    }
    return file;
  }

  async writeFile(
    filePath: string,
    content: string,
    options: { message: string },
  ): Promise<void> {
    this.files.set(filePath, content);
    this.writes.push({ path: filePath, message: options.message });
  }

  async deleteFile(
    filePath: string,
    _options: { message: string },
  ): Promise<void> {
    if (!this.files.delete(filePath)) {
      throw Object.assign(new Error("not a file"), { status: 404 });
    }
  }
}
