import { describe, expect, it } from "vitest";

import { createMongoStorageAdapter } from "@dashboard/lib/storage/mongo";

describe("Mongo storage adapter", () => {
  it("reads, lists, writes, and deletes text files through one storage contract", async () => {
    const db = new FakeMongoDatabase();
    const adapter = createMongoStorageAdapter(db, {
      versionFactory: nextVersion("v1", "v2"),
    });
    const target = { namespace: "acme/widgets" };

    await expect(
      adapter.writeText({
        target,
        path: "memory/intro.md",
        content: "# Intro\n",
        message: "write intro",
      }),
    ).resolves.toEqual({
      path: "memory/intro.md",
      version: "v1",
      url: null,
    });

    await expect(adapter.readText(target, "memory/intro.md")).resolves.toEqual(
      expect.objectContaining({
        path: "memory/intro.md",
        content: "# Intro\n",
        version: "v1",
        size: 8,
      }),
    );
    await expect(adapter.list(target, "memory")).resolves.toEqual({
      path: "memory",
      entries: [
        {
          name: "intro.md",
          path: "memory/intro.md",
          type: "file",
          size: 8,
        },
      ],
    });

    await adapter.deleteFile({
      target,
      path: "memory/intro.md",
      version: "v1",
      message: "delete intro",
    });

    await expect(
      adapter.readText(target, "memory/intro.md"),
    ).resolves.toBeNull();
  });

  it("keeps namespaces isolated", async () => {
    const db = new FakeMongoDatabase();
    const adapter = createMongoStorageAdapter(db, {
      versionFactory: nextVersion("v1", "v2"),
    });

    await adapter.writeText({
      target: { namespace: "acme/widgets" },
      path: "state.json",
      content: '{"repo":"widgets"}',
      message: "write widgets",
    });
    await adapter.writeText({
      target: { namespace: "acme/site" },
      path: "state.json",
      content: '{"repo":"site"}',
      message: "write site",
    });

    await expect(
      adapter.readText({ namespace: "acme/widgets" }, "state.json"),
    ).resolves.toEqual(
      expect.objectContaining({ content: '{"repo":"widgets"}' }),
    );
    await expect(
      adapter.readText({ namespace: "acme/site" }, "state.json"),
    ).resolves.toEqual(expect.objectContaining({ content: '{"repo":"site"}' }));
  });

  it("commits multiple files and directory deletions", async () => {
    const db = new FakeMongoDatabase();
    const adapter = createMongoStorageAdapter(db, {
      versionFactory: nextVersion("commit-1", "commit-2"),
    });
    const target = { namespace: "acme/widgets" };

    await expect(
      adapter.writeTextFiles({
        target,
        message: "write cms",
        files: [
          { path: "cms/config.json", content: "{}\n" },
          { path: "cms/collections/articles.json", content: "[]\n" },
        ],
      }),
    ).resolves.toEqual({ version: "commit-1" });

    await expect(adapter.list(target, "cms")).resolves.toEqual({
      path: "cms",
      entries: [
        {
          name: "collections",
          path: "cms/collections",
          type: "dir",
        },
        {
          name: "config.json",
          path: "cms/config.json",
          type: "file",
          size: 3,
        },
      ],
    });

    await expect(
      adapter.deleteDirectory({
        target,
        path: "cms",
        message: "delete cms",
      }),
    ).resolves.toEqual({ deleted: 2 });
    await expect(adapter.list(target, "cms")).resolves.toEqual({
      path: "cms",
      entries: [],
    });
  });

  it("enforces optimistic version checks for single-file writes", async () => {
    const db = new FakeMongoDatabase();
    const adapter = createMongoStorageAdapter(db, {
      versionFactory: nextVersion("v1", "v2"),
    });
    const target = { namespace: "acme/widgets" };

    await adapter.writeText({
      target,
      path: "state.json",
      content: "{}",
      message: "write state",
    });

    await expect(
      adapter.writeText({
        target,
        path: "state.json",
        content: '{"next":true}',
        message: "write stale",
        version: "old",
      }),
    ).rejects.toThrow("mongo_storage_version_conflict");
  });

  it("round-trips base64 files and metadata", async () => {
    const db = new FakeMongoDatabase();
    const adapter = createMongoStorageAdapter(db, {
      versionFactory: nextVersion("asset-v1"),
    });
    const target = { namespace: "acme/widgets" };
    const contentBase64 = Buffer.from([0, 1, 2, 255]).toString("base64");

    await expect(
      adapter.writeBase64({
        target,
        path: "assets/blob.bin",
        contentBase64,
        message: "write asset",
      }),
    ).resolves.toEqual({
      path: "assets/blob.bin",
      version: "asset-v1",
      url: null,
    });

    await expect(
      adapter.readText(target, "assets/blob.bin"),
    ).resolves.toMatchObject({
      path: "assets/blob.bin",
      version: "asset-v1",
      size: 4,
    });
    await expect(
      adapter.readMetadata(target, "assets/blob.bin"),
    ).resolves.toEqual({
      path: "assets/blob.bin",
      version: "asset-v1",
      size: 4,
    });
  });

  it("lists root entries without leaking nested grandchildren", async () => {
    const db = new FakeMongoDatabase();
    const adapter = createMongoStorageAdapter(db, {
      versionFactory: nextVersion("v1"),
    });
    const target = { namespace: "acme/widgets" };

    await adapter.writeTextFiles({
      target,
      message: "write files",
      files: [
        { path: "config.json", content: "{}" },
        { path: "cms/config.json", content: "{}" },
        { path: "cms/collections/articles.json", content: "[]" },
      ],
    });

    await expect(adapter.list(target, "")).resolves.toEqual({
      path: "",
      entries: [
        {
          name: "cms",
          path: "cms",
          type: "dir",
        },
        {
          name: "config.json",
          path: "config.json",
          type: "file",
          size: 2,
        },
      ],
    });
  });

  it("does not delete a file when the version is stale", async () => {
    const db = new FakeMongoDatabase();
    const adapter = createMongoStorageAdapter(db, {
      versionFactory: nextVersion("v1"),
    });
    const target = { namespace: "acme/widgets" };

    await adapter.writeText({
      target,
      path: "state.json",
      content: "{}",
      message: "write state",
    });
    await adapter.deleteFile({
      target,
      path: "state.json",
      version: "old",
      message: "delete stale",
    });

    await expect(adapter.readText(target, "state.json")).resolves.toEqual(
      expect.objectContaining({ version: "v1" }),
    );
  });

  it("rejects unsafe namespaces and paths", async () => {
    const db = new FakeMongoDatabase();
    const adapter = createMongoStorageAdapter(db);

    await expect(adapter.list({ namespace: " " }, "")).rejects.toThrow(
      "mongo storage namespace must not be empty",
    );
    await expect(
      adapter.readText({ namespace: "acme/widgets" }, "../secrets.enc"),
    ).rejects.toThrow("mongo storage path must be a safe relative path");
  });
});

function nextVersion(...versions: string[]): () => string {
  let index = 0;
  return () => versions[index++] ?? `v${index}`;
}

interface StoredDoc {
  _id: string;
  namespace: string;
  path: string;
  contentBase64: string;
  version: string;
  size: number;
  updatedAt: Date;
}

type StoredDocFilter = Omit<Partial<StoredDoc>, "path"> & {
  path?: string | RegExp;
};

class FakeMongoDatabase {
  collection(): FakeMongoCollection {
    return this.files;
  }

  private files = new FakeMongoCollection();
}

class FakeMongoCollection {
  private docs = new Map<string, StoredDoc>();

  async findOne(filter: StoredDocFilter): Promise<StoredDoc | null> {
    return [...this.docs.values()].find((doc) => matches(doc, filter)) ?? null;
  }

  async replaceOne(
    filter: StoredDocFilter,
    replacement: StoredDoc,
    options: { upsert?: boolean } = {},
  ): Promise<{ matchedCount: number; upsertedCount: number }> {
    const existing = await this.findOne(filter);
    if (existing) {
      this.docs.set(existing._id, replacement);
      return { matchedCount: 1, upsertedCount: 0 };
    }
    if (options.upsert) {
      this.docs.set(replacement._id, replacement);
      return { matchedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, upsertedCount: 0 };
  }

  async bulkWrite(
    operations: Array<{
      replaceOne: {
        filter: Partial<StoredDoc>;
        replacement: StoredDoc;
        upsert: true;
      };
    }>,
  ): Promise<void> {
    for (const operation of operations) {
      await this.replaceOne(
        operation.replaceOne.filter,
        operation.replaceOne.replacement,
        { upsert: operation.replaceOne.upsert },
      );
    }
  }

  find(filter: StoredDocFilter): {
    toArray(): Promise<StoredDoc[]>;
  } {
    const docs = [...this.docs.values()]
      .filter((doc) => matches(doc, filter))
      .sort((left, right) => left.path.localeCompare(right.path));
    return { toArray: async () => docs };
  }

  async deleteOne(filter: StoredDocFilter): Promise<{ deletedCount: number }> {
    const doc = await this.findOne(filter);
    if (!doc) return { deletedCount: 0 };
    this.docs.delete(doc._id);
    return { deletedCount: 1 };
  }

  async deleteMany(filter: StoredDocFilter): Promise<{ deletedCount: number }> {
    const docs = await this.find(filter).toArray();
    for (const doc of docs) this.docs.delete(doc._id);
    return { deletedCount: docs.length };
  }
}

function matches(doc: StoredDoc, filter: StoredDocFilter): boolean {
  for (const [key, value] of Object.entries(filter)) {
    const actual = doc[key as keyof StoredDoc];
    if (value instanceof RegExp) {
      if (typeof actual !== "string" || !value.test(actual)) return false;
      continue;
    }
    if (actual !== value) return false;
  }
  return true;
}
