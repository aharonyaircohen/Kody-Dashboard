import type {
  CmsCollectionConfig,
  CmsCollectionOperations,
  CmsConfigState,
  CmsDocument,
  CmsListResult,
  CmsPermissionsConfig,
  CmsSearchQuery,
  CmsSortEntry,
} from "../../cms/types";

interface CmsIndexResponse {
  cms?: CmsConfigState;
  error?: string;
  message?: string;
}

interface CmsAdaptersResponse {
  adapters?: CmsAdapterCatalogItem[];
  error?: string;
  message?: string;
}

interface CmsDocumentResponse {
  document?: CmsDocument;
  error?: string;
  message?: string;
}

interface CmsDeleteResponse {
  deleted?: boolean;
  error?: string;
  message?: string;
}

interface CmsSchemaResponse {
  cms?: CmsConfigState;
  generated?: { collections?: number };
  error?: string;
  message?: string;
}

interface CmsModelResponse {
  cms?: CmsConfigState;
  collection?: CmsCollectionConfig;
  error?: string;
  message?: string;
}

export interface GenerateCmsSchemaPayload {
  adapter: "mongodb";
  name?: string;
  refresh?: boolean;
}

export interface CmsAdapterCatalogItem {
  name: string;
  label: string;
  description: string;
  supportsSchemaGeneration: boolean;
  htmlUrl: string | null;
}

export interface SaveCmsPermissionsPayload {
  permissions?: CmsPermissionsConfig;
  collections: Array<{
    name: string;
    permissions: CmsPermissionsConfig;
    operations?: Pick<CmsCollectionOperations, "create" | "update" | "delete">;
  }>;
}

export interface SaveCmsAdapterPayload {
  adapter: string;
}

export interface SaveCmsModelResourcePayload {
  collection: CmsCollectionConfig;
  originalName?: string | null;
}

export async function fetchCmsConfig(
  headers: Record<string, string>,
): Promise<CmsConfigState> {
  const res = await fetch("/api/kody/cms", { headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as CmsIndexResponse;
  if (!res.ok || !json.cms) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.cms;
}

export async function fetchCmsAdapters(
  headers: Record<string, string>,
): Promise<CmsAdapterCatalogItem[]> {
  const res = await fetch("/api/kody/cms/adapters", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as CmsAdaptersResponse;
  if (!res.ok || !json.adapters) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.adapters;
}

export async function generateCmsSchema(
  headers: Record<string, string>,
  payload: GenerateCmsSchemaPayload,
): Promise<CmsConfigState> {
  const res = await fetch("/api/kody/cms/schema", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as CmsSchemaResponse;
  if (!res.ok || !json.cms) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.cms;
}

export async function createCmsConfig(
  headers: Record<string, string>,
  payload: { name?: string; adapter?: string },
): Promise<CmsConfigState> {
  const res = await fetch("/api/kody/cms", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as CmsIndexResponse;
  if (!res.ok || !json.cms) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.cms;
}

export async function saveCmsPermissions(
  headers: Record<string, string>,
  payload: SaveCmsPermissionsPayload,
): Promise<CmsConfigState> {
  const res = await fetch("/api/kody/cms", {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as CmsIndexResponse;
  if (!res.ok || !json.cms) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.cms;
}

export async function saveCmsAdapter(
  headers: Record<string, string>,
  payload: SaveCmsAdapterPayload,
): Promise<CmsConfigState> {
  const res = await fetch("/api/kody/cms", {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as CmsIndexResponse;
  if (!res.ok || !json.cms) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.cms;
}

export async function saveCmsModelResource(
  headers: Record<string, string>,
  payload: SaveCmsModelResourcePayload,
): Promise<CmsConfigState> {
  const res = await fetch("/api/kody/cms/model", {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as CmsModelResponse;
  if (!res.ok || !json.cms) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.cms;
}

export async function fetchCmsDocuments(
  headers: Record<string, string>,
  collection: string,
  filters: Record<string, Record<string, unknown>>,
  search: CmsSearchQuery | undefined,
  sort: CmsSortEntry[],
  limit: number,
  offset: number,
  ids: string[] = [],
): Promise<CmsListResult> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  for (const id of ids) {
    params.append("ids", id);
  }

  if (Object.keys(filters).length > 0) {
    params.set("filters", JSON.stringify(filters));
  }
  if (search?.query) {
    params.set("q", search.query);
    if (search.fields?.length) {
      params.set("searchFields", search.fields.join(","));
    }
  }
  if (sort.length > 0) {
    params.set("sort", serializeSort(sort));
  }

  const res = await fetch(
    `/api/kody/cms/${encodeURIComponent(collection)}?${params.toString()}`,
    { headers, cache: "no-store" },
  );
  const json = (await res.json().catch(() => ({}))) as CmsListResult & {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json;
}

export async function fetchCmsDocumentsByIds(
  headers: Record<string, string>,
  collection: string,
  ids: string[],
): Promise<CmsListResult> {
  return fetchCmsDocuments(
    headers,
    collection,
    {},
    undefined,
    [],
    ids.length,
    0,
    ids,
  );
}

export async function fetchCmsDocument(
  headers: Record<string, string>,
  collection: string,
  id: string,
): Promise<CmsDocument> {
  const res = await fetch(
    `/api/kody/cms/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    { headers, cache: "no-store" },
  );
  const json = (await res.json().catch(() => ({}))) as CmsDocumentResponse;
  if (!res.ok || !json.document) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.document;
}

export async function createCmsDocument(
  headers: Record<string, string>,
  collection: string,
  payload: CmsDocument,
): Promise<CmsDocument> {
  const res = await fetch(`/api/kody/cms/${encodeURIComponent(collection)}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as CmsDocumentResponse;
  if (!res.ok || !json.document) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.document;
}

export async function updateCmsDocument(
  headers: Record<string, string>,
  collection: string,
  id: string,
  payload: CmsDocument,
): Promise<CmsDocument> {
  const res = await fetch(
    `/api/kody/cms/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    },
  );
  const json = (await res.json().catch(() => ({}))) as CmsDocumentResponse;
  if (!res.ok || !json.document) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.document;
}

export async function deleteCmsDocument(
  headers: Record<string, string>,
  collection: string,
  id: string,
): Promise<boolean> {
  const res = await fetch(
    `/api/kody/cms/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers,
      cache: "no-store",
    },
  );
  const json = (await res.json().catch(() => ({}))) as CmsDeleteResponse;
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return Boolean(json.deleted);
}

function serializeSort(sort: CmsSortEntry[]): string {
  return sort
    .filter((entry) => entry.field)
    .map(
      (entry) => `${entry.field}:${entry.direction === "asc" ? "asc" : "desc"}`,
    )
    .join(",");
}
