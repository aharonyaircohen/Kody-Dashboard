import path from "node:path";

import type { StorageAdapter } from "./types";

export interface CmsStorageTransport {
  listFiles(dirPath: string): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
  writeFile(
    filePath: string,
    content: string,
    options: { message: string },
  ): Promise<void>;
  deleteFile(filePath: string, options: { message: string }): Promise<void>;
}

export function createCmsStorageTransport<TTarget>({
  adapter,
  resolveTarget,
  resolveBasePath,
}: {
  adapter: StorageAdapter<TTarget>;
  resolveTarget: () => Promise<TTarget>;
  resolveBasePath?: () => Promise<string>;
}): CmsStorageTransport {
  return {
    async listFiles(dirPath) {
      const [target, basePath] = await Promise.all([
        resolveTarget(),
        resolveBasePath?.() ?? Promise.resolve(""),
      ]);
      const rootPath = safeRootPath(basePath);
      const result = await adapter.list(
        target,
        withBasePath(rootPath, dirPath),
      );
      return result.entries
        .filter((entry) => entry.type === "file")
        .map((entry) => stripBasePath(rootPath, entry.path));
    },

    async readFile(filePath) {
      const [target, basePath] = await Promise.all([
        resolveTarget(),
        resolveBasePath?.() ?? Promise.resolve(""),
      ]);
      const file = await adapter.readText(
        target,
        withBasePath(safeRootPath(basePath), filePath),
      );
      if (!file) {
        throw Object.assign(new Error("not a file"), { status: 404 });
      }
      return file.content;
    },

    async writeFile(filePath, content, options) {
      const [target, basePath] = await Promise.all([
        resolveTarget(),
        resolveBasePath?.() ?? Promise.resolve(""),
      ]);
      const path = withBasePath(safeRootPath(basePath), filePath);
      const current = await adapter.readMetadata(target, path);
      await adapter.writeText({
        target,
        path,
        content,
        message: options.message,
        ...(current?.version ? { version: current.version } : {}),
      });
    },

    async deleteFile(filePath, options) {
      const [target, basePath] = await Promise.all([
        resolveTarget(),
        resolveBasePath?.() ?? Promise.resolve(""),
      ]);
      const path = withBasePath(safeRootPath(basePath), filePath);
      const current = await adapter.readMetadata(target, path);
      if (!current) {
        throw Object.assign(new Error("not a file"), { status: 404 });
      }
      await adapter.deleteFile({
        target,
        path,
        version: current.version,
        message: options.message,
      });
    },
  };
}

function withBasePath(basePath: string, filePath: string): string {
  return safeJoin(basePath, filePath);
}

function stripBasePath(basePath: string, filePath: string): string {
  const normalizedBase = safeRootPath(basePath);
  const normalizedFile = safeRootPath(filePath);
  if (!normalizedBase) return normalizedFile;
  return normalizedFile.startsWith(`${normalizedBase}/`)
    ? normalizedFile.slice(normalizedBase.length + 1)
    : normalizedFile;
}

function safeJoin(...segments: string[]): string {
  const joined = segments.filter(Boolean).join("/");
  const normalized = path.posix.normalize(joined).replace(/^\/+|\/+$/g, "");
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("resolved storage path escapes root");
  }
  return normalized;
}

function safeRootPath(value: string): string {
  if (!value) return "";
  return safeJoin(value);
}
