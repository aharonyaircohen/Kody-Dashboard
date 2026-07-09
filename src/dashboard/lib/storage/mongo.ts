import { randomUUID } from "node:crypto";

import type {
  StorageAdapter,
  StorageEntry,
  StorageFile,
  StorageFileMetadata,
} from "./types";

export interface MongoStorageTarget {
  namespace: string;
}

export interface MongoStorageAdapterOptions {
  collectionName?: string;
  versionFactory?: () => string;
}

interface MongoStorageDocument {
  _id: string;
  namespace: string;
  path: string;
  contentBase64: string;
  version: string;
  size: number;
  updatedAt: Date;
}

interface MongoStorageDatabase {
  collection(name: string): MongoStorageCollection;
}

interface MongoStorageCollection {
  findOne(filter: MongoStorageFilter): Promise<MongoStorageDocument | null>;
  find(filter: MongoStorageFilter): {
    toArray(): Promise<MongoStorageDocument[]>;
  };
  replaceOne(
    filter: MongoStorageFilter,
    replacement: MongoStorageDocument,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount?: number; upsertedCount?: number }>;
  bulkWrite(
    operations: Array<{
      replaceOne: {
        filter: MongoStorageFilter;
        replacement: MongoStorageDocument;
        upsert: true;
      };
    }>,
  ): Promise<unknown>;
  deleteOne(filter: MongoStorageFilter): Promise<{ deletedCount?: number }>;
  deleteMany(filter: MongoStorageFilter): Promise<{ deletedCount?: number }>;
}

type MongoStorageFilter = Partial<
  Pick<MongoStorageDocument, "_id" | "namespace" | "version">
> & {
  path?: string | RegExp;
};

const DEFAULT_COLLECTION = "kody_storage_files";

export function createMongoStorageAdapter(
  db: MongoStorageDatabase,
  options: MongoStorageAdapterOptions = {},
): StorageAdapter<MongoStorageTarget> {
  const collection = db.collection(
    options.collectionName ?? DEFAULT_COLLECTION,
  );
  const nextVersion = options.versionFactory ?? (() => randomUUID());

  return {
    name: "mongo",

    async readText(target, path) {
      const doc = await collection.findOne(fileFilter(target, path));
      return doc ? normalizeFile(doc, path) : null;
    },

    async readMetadata(target, path) {
      const doc = await collection.findOne(fileFilter(target, path));
      return doc ? normalizeMetadata(doc, path) : null;
    },

    async list(target, path) {
      const directory = normalizeStoragePath(path, { allowRoot: true });
      const docs = await collection
        .find({
          namespace: normalizeNamespace(target.namespace),
          path: directoryPrefixRegex(directory),
        })
        .toArray();
      return {
        path: directory,
        entries: normalizeEntries(directory, docs),
      };
    },

    async writeText(writeOptions) {
      return this.writeBase64({
        ...writeOptions,
        contentBase64: Buffer.from(writeOptions.content, "utf8").toString(
          "base64",
        ),
      });
    },

    async writeBase64(writeOptions) {
      const path = normalizeStoragePath(writeOptions.path);
      const version = nextVersion();
      const doc = makeDocument(
        writeOptions.target,
        path,
        writeOptions.contentBase64,
        version,
      );
      const filter: MongoStorageFilter = {
        ...fileFilter(writeOptions.target, path),
        ...(writeOptions.version ? { version: writeOptions.version } : {}),
      };
      const result = await collection.replaceOne(filter, doc, {
        upsert: !writeOptions.version,
      });
      if (
        writeOptions.version &&
        (result.matchedCount ?? 0) === 0 &&
        (result.upsertedCount ?? 0) === 0
      ) {
        throw new Error("mongo_storage_version_conflict");
      }
      return { path, version, url: null };
    },

    async writeTextFiles(writeOptions) {
      if (writeOptions.files.length === 0) {
        throw new Error("No storage files to write");
      }
      const version = nextVersion();
      await collection.bulkWrite(
        writeOptions.files.map((file) => {
          const path = normalizeStoragePath(file.path);
          return {
            replaceOne: {
              filter: fileFilter(writeOptions.target, path),
              replacement: makeDocument(
                writeOptions.target,
                path,
                Buffer.from(file.content, "utf8").toString("base64"),
                version,
              ),
              upsert: true,
            },
          };
        }),
      );
      return { version };
    },

    async writeBase64Files(writeOptions) {
      if (writeOptions.files.length === 0) {
        throw new Error("No storage files to write");
      }
      const version = nextVersion();
      await collection.bulkWrite(
        writeOptions.files.map((file) => {
          const path = normalizeStoragePath(file.path);
          return {
            replaceOne: {
              filter: fileFilter(writeOptions.target, path),
              replacement: makeDocument(
                writeOptions.target,
                path,
                file.contentBase64,
                version,
              ),
              upsert: true,
            },
          };
        }),
      );
      return { version };
    },

    async deleteFile(deleteOptions) {
      await collection.deleteOne({
        ...fileFilter(deleteOptions.target, deleteOptions.path),
        version: deleteOptions.version,
      });
    },

    async deleteDirectory(deleteOptions) {
      const directory = normalizeStoragePath(deleteOptions.path, {
        allowRoot: true,
      });
      const result = await collection.deleteMany({
        namespace: normalizeNamespace(deleteOptions.target.namespace),
        path: directoryPrefixRegex(directory),
      });
      return { deleted: result.deletedCount ?? 0 };
    },
  };
}

function normalizeFile(
  doc: MongoStorageDocument,
  requestedPath: string,
): StorageFile {
  return {
    path: normalizeStoragePath(requestedPath),
    content: Buffer.from(doc.contentBase64, "base64").toString("utf8"),
    version: doc.version,
    size: doc.size,
  };
}

function normalizeMetadata(
  doc: MongoStorageDocument,
  requestedPath: string,
): StorageFileMetadata {
  return {
    path: normalizeStoragePath(requestedPath),
    version: doc.version,
    size: doc.size,
  };
}

function normalizeEntries(
  directory: string,
  docs: MongoStorageDocument[],
): StorageEntry[] {
  const prefix = directory ? `${directory}/` : "";
  const byPath = new Map<string, StorageEntry>();
  for (const doc of docs) {
    const relative = doc.path.slice(prefix.length);
    if (!relative) continue;
    const [name, ...rest] = relative.split("/");
    if (!name) continue;
    if (rest.length === 0) {
      byPath.set(doc.path, {
        name,
        path: doc.path,
        type: "file",
        size: doc.size,
      });
      continue;
    }
    const dirPath = `${prefix}${name}`;
    byPath.set(dirPath, {
      name,
      path: dirPath,
      type: "dir",
    });
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function makeDocument(
  target: MongoStorageTarget,
  path: string,
  contentBase64: string,
  version: string,
): MongoStorageDocument {
  return {
    _id: documentId(target, path),
    namespace: normalizeNamespace(target.namespace),
    path,
    contentBase64,
    version,
    size: Buffer.from(contentBase64, "base64").length,
    updatedAt: new Date(),
  };
}

function fileFilter(
  target: MongoStorageTarget,
  rawPath: string,
): MongoStorageFilter {
  const path = normalizeStoragePath(rawPath);
  return {
    _id: documentId(target, path),
    namespace: normalizeNamespace(target.namespace),
    path,
  };
}

function documentId(target: MongoStorageTarget, path: string): string {
  return `${normalizeNamespace(target.namespace)}:${path}`;
}

function normalizeNamespace(namespace: string): string {
  const value = namespace.trim().replace(/^\/+|\/+$/g, "");
  if (!value) throw new Error("mongo storage namespace must not be empty");
  return value;
}

function normalizeStoragePath(
  raw: string,
  options: { allowRoot?: boolean } = {},
): string {
  const value = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!value && options.allowRoot) return "";
  if (!value) throw new Error("mongo storage path must not be empty");
  const parts = value.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new Error("mongo storage path must be a safe relative path");
    }
  }
  return parts.join("/");
}

function directoryPrefixRegex(directory: string): RegExp {
  const prefix = directory ? `${directory}/` : "";
  return new RegExp(`^${escapeRegExp(prefix)}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
