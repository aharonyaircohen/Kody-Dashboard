import "server-only";

import type { NextRequest } from "next/server";
import type { Octokit } from "@octokit/rest";

import { getSecret } from "@dashboard/lib/vault/get-secret";
import {
  assertReadOperationAllowed,
  assertWriteOperationAllowed,
  CmsConfigError,
  getCollection,
  loadCmsConfigFromState,
  normalizeSearchQuery,
  normalizeSortQuery,
  toPublicCmsConfig,
  toUnconfiguredCmsConfig,
} from "./config";
import {
  CmsAdapterError,
  getCmsAdapter,
  type CmsAdapter,
  type CmsAdapterContext,
} from "./adapters";
import { getCmsActorRole } from "./roles";
import type {
  CmsCollectionConfig,
  CmsDocument,
  CmsListQuery,
  CmsListResult,
  CmsConfigState,
  CmsRole,
  CmsRuntimeConfig,
} from "./types";

export class CmsRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "CmsRuntimeError";
    this.code = code;
    this.status = status;
  }
}

export async function listCmsCollections(
  octokit: Octokit,
  owner: string,
  repo: string,
  actorRole?: CmsRole,
): Promise<CmsConfigState> {
  const config = await loadCmsConfigFromState(octokit, owner, repo);
  if (!config) {
    return toUnconfiguredCmsConfig();
  }
  return toPublicCmsConfig(config, actorRole);
}

export async function listCmsDocuments(
  req: NextRequest,
  octokit: Octokit,
  owner: string,
  repo: string,
  collectionName: string,
  query: CmsListQuery,
): Promise<CmsListResult> {
  const config = await loadCmsConfigFromState(octokit, owner, repo);
  if (!config) {
    throw new CmsConfigError(["CMS is not configured for this repo"], {
      code: "cms_not_configured",
      status: 404,
    });
  }
  const collection = getCollection(config, collectionName);
  const actorRole = await getCmsActorRole(req, octokit, owner, repo);
  assertReadOperationAllowed(
    collection,
    hasSearchQuery(query) ||
      (query.filters && Object.keys(query.filters).length > 0)
      ? "search"
      : "list",
    actorRole,
    config.permissions,
  );

  const { adapter, context } = getAdapterContext(req, config, collection);

  if (query.ids && query.ids.length > 0) {
    const docs = await callCmsAdapter(() =>
      adapter.listByIds(context, query.ids ?? []),
    );
    return {
      docs,
      total: docs.length,
      limit: docs.length,
      offset: 0,
    };
  }

  return callCmsAdapter(() =>
    adapter.list(context, {
      ...query,
      search: normalizeSearchQuery(collection, query.search),
      sort: normalizeSortQuery(collection, query.sort),
    }),
  );
}

export async function getCmsDocument(
  req: NextRequest,
  octokit: Octokit,
  owner: string,
  repo: string,
  collectionName: string,
  id: string,
): Promise<CmsDocument | null> {
  const config = await loadCmsConfigFromState(octokit, owner, repo);
  if (!config) {
    throw new CmsConfigError(["CMS is not configured for this repo"], {
      code: "cms_not_configured",
      status: 404,
    });
  }
  const collection = getCollection(config, collectionName);
  const actorRole = await getCmsActorRole(req, octokit, owner, repo);
  assertReadOperationAllowed(collection, "get", actorRole, config.permissions);

  const { adapter, context } = getAdapterContext(req, config, collection);
  return callCmsAdapter(() => adapter.get(context, id));
}

export async function createCmsDocument(
  req: NextRequest,
  octokit: Octokit,
  owner: string,
  repo: string,
  collectionName: string,
  data: CmsDocument,
): Promise<CmsDocument> {
  const config = await loadCmsConfigFromState(octokit, owner, repo);
  if (!config) {
    throw new CmsConfigError(["CMS is not configured for this repo"], {
      code: "cms_not_configured",
      status: 404,
    });
  }
  const collection = getCollection(config, collectionName);
  const actorRole = await getCmsActorRole(req, octokit, owner, repo);
  assertWriteOperationAllowed(
    collection,
    "create",
    actorRole,
    config.permissions,
  );

  const { adapter, context } = getAdapterContext(req, config, collection);
  return callCmsAdapter(() => adapter.create(context, data));
}

export async function updateCmsDocument(
  req: NextRequest,
  octokit: Octokit,
  owner: string,
  repo: string,
  collectionName: string,
  id: string,
  data: CmsDocument,
): Promise<CmsDocument | null> {
  const config = await loadCmsConfigFromState(octokit, owner, repo);
  if (!config) {
    throw new CmsConfigError(["CMS is not configured for this repo"], {
      code: "cms_not_configured",
      status: 404,
    });
  }
  const collection = getCollection(config, collectionName);
  const actorRole = await getCmsActorRole(req, octokit, owner, repo);
  assertWriteOperationAllowed(
    collection,
    "update",
    actorRole,
    config.permissions,
  );

  const { adapter, context } = getAdapterContext(req, config, collection);
  return callCmsAdapter(() => adapter.update(context, id, data));
}

export async function deleteCmsDocument(
  req: NextRequest,
  octokit: Octokit,
  owner: string,
  repo: string,
  collectionName: string,
  id: string,
): Promise<boolean> {
  const config = await loadCmsConfigFromState(octokit, owner, repo);
  if (!config) {
    throw new CmsConfigError(["CMS is not configured for this repo"], {
      code: "cms_not_configured",
      status: 404,
    });
  }
  const collection = getCollection(config, collectionName);
  const actorRole = await getCmsActorRole(req, octokit, owner, repo);
  assertWriteOperationAllowed(
    collection,
    "delete",
    actorRole,
    config.permissions,
  );

  const { adapter, context } = getAdapterContext(req, config, collection);
  return callCmsAdapter(() => adapter.delete(context, id));
}

export function parseCmsListQuery(req: NextRequest): CmsListQuery {
  const params = req.nextUrl.searchParams;
  return {
    ids: parseIdsParam(params),
    filters: parseFiltersParam(params.get("filters")),
    search: parseSearchParam(params),
    sort: parseSortParam(params.get("sort")),
    limit: parseNumberParam(params.get("limit")),
    offset: parseNumberParam(params.get("offset")),
  };
}

function parseIdsParam(params: URLSearchParams): string[] {
  const ids = params
    .getAll("ids")
    .flatMap((value) => value.split(","))
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)].slice(0, 100);
}

function hasSearchQuery(query: CmsListQuery): boolean {
  return (
    typeof query.search?.query === "string" && query.search.query.trim() !== ""
  );
}

function getAdapterContext(
  req: NextRequest,
  config: CmsRuntimeConfig,
  collection: CmsCollectionConfig,
): { adapter: CmsAdapter; context: CmsAdapterContext } {
  const adapter = getCmsAdapter(collection.adapter);
  if (!adapter) {
    throw new CmsRuntimeError(
      "unsupported_adapter",
      `CMS adapter "${collection.adapter}" is not available.`,
      400,
    );
  }

  return {
    adapter,
    context: {
      config,
      collection,
      settings: config.adapters[collection.adapter] ?? {},
      getSecret: (name) => getSecret(name, { req }),
    },
  };
}

async function callCmsAdapter<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CmsAdapterError) {
      throw new CmsRuntimeError(error.code, error.message, error.status);
    }
    throw error;
  }
}

function parseFiltersParam(value: string | null): CmsListQuery["filters"] {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as CmsListQuery["filters"])
      : {};
  } catch {
    throw new CmsConfigError(["filters must be valid JSON"]);
  }
}

function parseSearchParam(params: URLSearchParams): CmsListQuery["search"] {
  const query = params.get("q")?.trim();
  if (!query) return undefined;
  const fields = params
    .get("searchFields")
    ?.split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  return {
    query,
    ...(fields && fields.length > 0 ? { fields } : {}),
  };
}

function parseSortParam(value: string | null): CmsListQuery["sort"] {
  if (!value) return undefined;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [field, direction] = entry.split(":");
      if (!field) return [];
      return [
        {
          field,
          direction: direction === "asc" ? "asc" : "desc",
        } as const,
      ];
    });
}

function parseNumberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
