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
  createMongoDocument,
  deleteMongoDocument,
  getMongoDocument,
  listMongoDocuments,
  updateMongoDocument,
} from "./mongodb";
import type {
  CmsDocument,
  CmsListQuery,
  CmsListResult,
  CmsConfigState,
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
): Promise<CmsConfigState> {
  const config = await loadCmsConfigFromState(octokit, owner, repo);
  if (!config) {
    return toUnconfiguredCmsConfig();
  }
  return toPublicCmsConfig(config);
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
  assertReadOperationAllowed(
    collection,
    hasSearchQuery(query) ||
      (query.filters && Object.keys(query.filters).length > 0)
      ? "search"
      : "list",
  );

  if (collection.adapter !== "mongodb") {
    throw new CmsRuntimeError(
      "unsupported_adapter",
      `CMS adapter "${collection.adapter}" is not supported by the Dashboard UI yet.`,
      400,
    );
  }

  const { uri, databaseName } = await resolveMongoSettings(
    req,
    config,
    collection.adapter,
  );
  return listMongoDocuments({
    uri,
    databaseName,
    config,
    collection,
    query: {
      ...query,
      search: normalizeSearchQuery(collection, query.search),
      sort: normalizeSortQuery(collection, query.sort),
    },
  });
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
  assertReadOperationAllowed(collection, "get");

  if (collection.adapter !== "mongodb") {
    throw new CmsRuntimeError(
      "unsupported_adapter",
      `CMS adapter "${collection.adapter}" is not supported by the Dashboard UI yet.`,
      400,
    );
  }

  const { uri, databaseName } = await resolveMongoSettings(
    req,
    config,
    collection.adapter,
  );
  return getMongoDocument({ uri, databaseName, config, collection, id });
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
    throw new CmsConfigError(["CMS is not configured repo"], {
      code: "cms_not_configured",
      status: 404,
    });
  }
  const collection = getCollection(config, collectionName);
  assertWriteOperationAllowed(collection, "create");

  if (collection.adapter !== "mongodb") {
    throw new CmsRuntimeError(
      "unsupported_adapter",
      `CMS adapter "${collection.adapter}" not supported by Dashboard UI yet.`,
      400,
    );
  }

  const { uri, databaseName } = await resolveMongoSettings(
    req,
    config,
    collection.adapter,
  );
  return createMongoDocument({ uri, databaseName, config, collection, data });
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
    throw new CmsConfigError(["CMS is not configured repo"], {
      code: "cms_not_configured",
      status: 404,
    });
  }
  const collection = getCollection(config, collectionName);
  assertWriteOperationAllowed(collection, "update");

  if (collection.adapter !== "mongodb") {
    throw new CmsRuntimeError(
      "unsupported_adapter",
      `CMS adapter "${collection.adapter}" not supported by Dashboard UI yet.`,
      400,
    );
  }

  const { uri, databaseName } = await resolveMongoSettings(
    req,
    config,
    collection.adapter,
  );
  return updateMongoDocument({
    uri,
    databaseName,
    config,
    collection,
    id,
    data,
  });
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
    throw new CmsConfigError(["CMS is not configured repo"], {
      code: "cms_not_configured",
      status: 404,
    });
  }
  const collection = getCollection(config, collectionName);
  assertWriteOperationAllowed(collection, "delete");

  if (collection.adapter !== "mongodb") {
    throw new CmsRuntimeError(
      "unsupported_adapter",
      `CMS adapter "${collection.adapter}" not supported by Dashboard UI yet.`,
      400,
    );
  }

  const { uri, databaseName } = await resolveMongoSettings(
    req,
    config,
    collection.adapter,
  );
  return deleteMongoDocument({ uri, databaseName, config, collection, id });
}

export function parseCmsListQuery(req: NextRequest): CmsListQuery {
  const params = req.nextUrl.searchParams;
  return {
    filters: parseFiltersParam(params.get("filters")),
    search: parseSearchParam(params),
    sort: parseSortParam(params.get("sort")),
    limit: parseNumberParam(params.get("limit")),
    offset: parseNumberParam(params.get("offset")),
  };
}

function hasSearchQuery(query: CmsListQuery): boolean {
  return (
    typeof query.search?.query === "string" && query.search.query.trim() !== ""
  );
}

async function resolveMongoSettings(
  req: NextRequest,
  config: CmsRuntimeConfig,
  adapterName: string,
): Promise<{ uri: string; databaseName?: string }> {
  const adapter = config.adapters[adapterName] ?? {};
  const databaseUriSecret =
    typeof adapter.databaseUriSecret === "string"
      ? adapter.databaseUriSecret
      : null;
  const databaseName =
    typeof adapter.databaseName === "string" && adapter.databaseName.trim()
      ? adapter.databaseName.trim()
      : undefined;

  if (!databaseUriSecret) {
    throw new CmsRuntimeError(
      "missing_database_uri_secret",
      `CMS adapter "${adapterName}" does not define databaseUriSecret.`,
      400,
    );
  }
  const uri = await getSecret(databaseUriSecret, { req });
  if (!uri) {
    throw new CmsRuntimeError(
      "missing_secret",
      `Secret "${databaseUriSecret}" is not configured.`,
      500,
    );
  }

  return { uri, databaseName };
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
