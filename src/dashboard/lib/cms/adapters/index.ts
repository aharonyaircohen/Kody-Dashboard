import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Octokit } from "@octokit/rest";

import type {
  CmsCollectionConfig,
  CmsDocument,
  CmsListQuery,
  CmsListResult,
  CmsRuntimeConfig,
} from "../types";
import {
  CmsAdapterError,
  type CmsAdapter,
  type CmsAdapterContext,
} from "./types";

const ADAPTERS_ROOT_ENV = "KODY_CMS_ADAPTERS_ROOT";
const STORE_ROOT_ENV = "KODY_STORE_ROOT";
const DEFAULT_STORE = {
  owner: "aharonyaircohen",
  repo: "kody-company-store",
  ref: "stable",
};
const REMOTE_MODULE_TTL_MS = 60_000;

const ADAPTERS = new Map<string, CmsAdapter>();
const MODULES = new Map<string, Promise<StoreAdapterModule>>();
const REMOTE_MODULE_URLS = new Map<
  string,
  { expiresAt: number; value: Promise<string> }
>();

type StoreAdapterOptions = {
  config: CmsRuntimeConfig;
  collection: CmsCollectionConfig;
  settings: CmsAdapterContext["settings"];
  getSecret: CmsAdapterContext["getSecret"];
  getStateRepository: CmsAdapterContext["getStateRepository"];
  context: CmsAdapterContext;
};

type StoreAdapterModule = {
  createCmsAdapter?: (options: StoreAdapterOptions) => StoreCmsAdapter;
};

type StoreCmsAdapter = {
  list?: (
    collectionName: string,
    query?: CmsListQuery,
  ) => Promise<CmsListResult>;
  listByIds?: (collectionName: string, ids: string[]) => Promise<CmsDocument[]>;
  get?: (collectionName: string, id: string) => Promise<CmsDocument | null>;
  create?: (collectionName: string, data: CmsDocument) => Promise<CmsDocument>;
  update?: (
    collectionName: string,
    id: string,
    data: CmsDocument,
  ) => Promise<CmsDocument | null>;
  delete?: (
    collectionName: string,
    id: string,
  ) => Promise<boolean | { deleted?: boolean }>;
};
type StoreMethod = (...args: unknown[]) => unknown;

export function getCmsAdapter(name: string): CmsAdapter | null {
  const adapterName = normalizeAdapterName(name);
  if (!adapterName) return null;

  let adapter = ADAPTERS.get(adapterName);
  if (!adapter) {
    adapter = createStoreAdapterBridge(adapterName);
    ADAPTERS.set(adapterName, adapter);
  }
  return adapter;
}

function createStoreAdapterBridge(name: string): CmsAdapter {
  return {
    name,
    list: (context, query) =>
      withStoreAdapter(name, context, async (adapter) => {
        assertStoreMethod(adapter, "list", name);
        return adapter.list(context.collection.name, query);
      }),
    listByIds: (context, ids) =>
      withStoreAdapter(name, context, async (adapter) => {
        if (adapter.listByIds) {
          return adapter.listByIds(context.collection.name, ids);
        }
        assertStoreMethod(adapter, "get", name);
        const docs = await Promise.all(
          ids.map((id) => adapter.get?.(context.collection.name, id)),
        );
        return docs.filter((doc): doc is CmsDocument => doc != null);
      }),
    get: (context, id) =>
      withStoreAdapter(name, context, async (adapter) => {
        assertStoreMethod(adapter, "get", name);
        return adapter.get(context.collection.name, id);
      }),
    create: (context, data) =>
      withStoreAdapter(name, context, async (adapter) => {
        assertStoreMethod(adapter, "create", name);
        return adapter.create(context.collection.name, data);
      }),
    update: (context, id, data) =>
      withStoreAdapter(name, context, async (adapter) => {
        assertStoreMethod(adapter, "update", name);
        return adapter.update(context.collection.name, id, data);
      }),
    delete: (context, id) =>
      withStoreAdapter(name, context, async (adapter) => {
        assertStoreMethod(adapter, "delete", name);
        const result = await adapter.delete(context.collection.name, id);
        if (typeof result === "boolean") return result;
        return result.deleted === true;
      }),
  };
}

async function withStoreAdapter<T>(
  name: string,
  context: CmsAdapterContext,
  operation: (adapter: StoreCmsAdapter) => Promise<T>,
): Promise<T> {
  try {
    const adapterModule = await loadStoreAdapterModule(name, context);
    if (typeof adapterModule.createCmsAdapter !== "function") {
      throw new CmsAdapterError(
        "invalid_store_adapter",
        `CMS adapter "${name}" does not export createCmsAdapter.`,
        500,
      );
    }
    return await operation(
      adapterModule.createCmsAdapter({
        config: context.config,
        collection: context.collection,
        settings: context.settings,
        getSecret: context.getSecret,
        getStateRepository: context.getStateRepository,
        context,
      }),
    );
  } catch (error) {
    throw normalizeStoreAdapterError(error);
  }
}

async function loadStoreAdapterModule(
  name: string,
  context: CmsAdapterContext,
): Promise<StoreAdapterModule> {
  const moduleUrl = await resolveStoreAdapterModuleUrl(name, context);
  let modulePromise = MODULES.get(moduleUrl);
  if (!modulePromise) {
    modulePromise = import(moduleUrl) as Promise<StoreAdapterModule>;
    MODULES.set(moduleUrl, modulePromise);
  }
  return modulePromise;
}

async function resolveStoreAdapterModuleUrl(
  name: string,
  context: CmsAdapterContext,
): Promise<string> {
  if (context.store?.octokit) {
    return resolveRemoteStoreAdapterModuleUrl(name, context.store);
  }

  const localUrl = resolveLocalStoreAdapterModuleUrl(name);
  if (localUrl) return localUrl;

  throw new CmsAdapterError(
    "store_adapter_not_found",
    `CMS adapter "${name}" is not available in the configured Dashboard store.`,
    400,
  );
}

function resolveLocalStoreAdapterModuleUrl(name: string): string | null {
  const root = resolveLocalStoreAdaptersRoot();
  if (!root) return null;

  const candidates = [
    path.join(root, name, "index.mjs"),
    path.join(root, `${name}.mjs`),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  return file ? pathToFileURL(file).href : null;
}

function resolveLocalStoreAdaptersRoot(): string | null {
  const explicitRoot = stringEnv(ADAPTERS_ROOT_ENV);
  if (explicitRoot) return path.resolve(explicitRoot);

  const storeRoot = stringEnv(STORE_ROOT_ENV);
  if (storeRoot) return path.resolve(storeRoot, "cms/adapters");

  const siblingStoreAdapters = path.resolve(
    process.cwd(),
    "../kody-store/cms/adapters",
  );
  return existsSync(siblingStoreAdapters) ? siblingStoreAdapters : null;
}

async function resolveRemoteStoreAdapterModuleUrl(
  name: string,
  store: NonNullable<CmsAdapterContext["store"]>,
): Promise<string> {
  const target = parseStoreTarget(store.repoUrl, store.ref);
  const key = `${target.owner}/${target.repo}@${target.ref}:${name}`;
  const cached = REMOTE_MODULE_URLS.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = materializeRemoteStoreAdapter(name, store.octokit, target);
  REMOTE_MODULE_URLS.set(key, {
    expiresAt: Date.now() + REMOTE_MODULE_TTL_MS,
    value,
  });
  return value;
}

async function materializeRemoteStoreAdapter(
  name: string,
  octokit: Octokit,
  target: StoreTarget,
): Promise<string> {
  const adapterPath = `cms/adapters/${name}/index.mjs`;
  const contractPath = "cms/contract/index.mjs";
  const [adapterFile, contractFile] = await Promise.all([
    readStoreFile(octokit, target, adapterPath),
    readStoreFile(octokit, target, contractPath),
  ]);
  const hash = createHash("sha256")
    .update(`${target.owner}/${target.repo}@${target.ref}\0`)
    .update(adapterPath)
    .update(adapterFile.content)
    .update(contractPath)
    .update(contractFile.content)
    .digest("hex")
    .slice(0, 24);
  const root = path.join(tmpdir(), "kody-cms-store-adapters", hash);
  await Promise.all([
    writeMaterializedFile(root, adapterPath, adapterFile.content),
    writeMaterializedFile(root, contractPath, contractFile.content),
  ]);
  await linkRuntimeNodeModules(root);
  return pathToFileURL(path.join(root, adapterPath)).href;
}

async function linkRuntimeNodeModules(root: string): Promise<void> {
  const runtimeNodeModules = path.resolve(process.cwd(), "node_modules");
  if (!existsSync(runtimeNodeModules)) return;

  const linkPath = path.join(root, "node_modules");
  if (existsSync(linkPath)) return;

  try {
    await symlink(runtimeNodeModules, linkPath, "dir");
  } catch (error) {
    if ((error as { code?: string })?.code === "EEXIST") return;
    throw error;
  }
}

async function readStoreFile(
  octokit: Octokit,
  target: StoreTarget,
  filePath: string,
): Promise<{ content: string }> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path: filePath,
      ref: target.ref,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content) {
      throw new CmsAdapterError(
        "store_adapter_not_found",
        `CMS Store file not found: ${filePath}`,
        400,
      );
    }
    return {
      content: Buffer.from(data.content, "base64").toString("utf8"),
    };
  } catch (error) {
    if ((error as { status?: number })?.status === 404) {
      throw new CmsAdapterError(
        "store_adapter_not_found",
        `CMS Store file not found: ${filePath}`,
        400,
      );
    }
    throw error;
  }
}

async function writeMaterializedFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

interface StoreTarget {
  owner: string;
  repo: string;
  ref: string;
}

function parseStoreTarget(
  repoUrl: string | undefined,
  ref: string | undefined,
): StoreTarget {
  const raw = repoUrl?.trim() || `${DEFAULT_STORE.owner}/${DEFAULT_STORE.repo}`;
  const withoutSuffix = raw.replace(/\/$/, "").replace(/\.git$/, "");
  const repoPath = withoutSuffix.startsWith("https://github.com/")
    ? withoutSuffix.slice("https://github.com/".length)
    : withoutSuffix;
  const [owner, repo] = repoPath.split("/", 2);
  if (
    !owner ||
    !repo ||
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repo)
  ) {
    throw new CmsAdapterError(
      "invalid_store_target",
      "CMS Store target must be a GitHub owner/repo or HTTPS URL.",
      400,
    );
  }
  return {
    owner,
    repo,
    ref: ref?.trim() || DEFAULT_STORE.ref,
  };
}

function normalizeStoreAdapterError(error: unknown): Error {
  if (error instanceof CmsAdapterError) return error;
  if (isRecord(error) && error.name === "CmsAdapterError") {
    return new CmsAdapterError(
      stringValue(error.code) ?? "store_adapter_error",
      sanitizeErrorMessage(error.message),
      numberValue(error.status) ?? 500,
    );
  }
  if (isRecord(error) && error.name === "CmsConfigError") {
    return new CmsAdapterError(
      "store_adapter_error",
      sanitizeErrorMessage(error.message),
      400,
    );
  }
  const routeHandledError = toRouteHandledError(error);
  if (routeHandledError) return routeHandledError;
  return new CmsAdapterError(
    "store_adapter_error",
    sanitizeErrorMessage(
      error instanceof Error ? error.message : String(error),
    ),
    500,
  );
}

function assertStoreMethod(
  adapter: StoreCmsAdapter,
  method: keyof StoreCmsAdapter,
  name: string,
): asserts adapter is StoreCmsAdapter & Record<typeof method, StoreMethod> {
  if (typeof adapter[method] !== "function") {
    throw new CmsAdapterError(
      "invalid_store_adapter",
      `CMS adapter "${name}" does not implement ${method}.`,
      500,
    );
  }
}

function normalizeAdapterName(name: string): string | null {
  const normalized = name.trim();
  return /^[a-z0-9][a-z0-9_-]*$/i.test(normalized) ? normalized : null;
}

function stringEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is {
  code?: unknown;
  message: string;
  name?: unknown;
  status?: unknown;
} {
  return value !== null && typeof value === "object" && "message" in value;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRouteHandledError(error: unknown): Error | null {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? numberValue((error as { status?: unknown }).status)
      : null;
  if (
    status !== 401 &&
    status !== 403 &&
    !message.toLowerCase().includes("rate limit")
  ) {
    return null;
  }

  const result = error instanceof Error ? error : new Error(message);
  if (status != null) Object.assign(result, { status });
  return result;
}

function sanitizeErrorMessage(message: string): string {
  return message.replace(
    /(mongodb(?:\+srv)?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi,
    "$1$2:***@",
  );
}

export type { CmsAdapter, CmsAdapterContext } from "./types";
export { CmsAdapterError } from "./types";
