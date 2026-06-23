import type {
  CmsConfigState,
  CmsDocument,
  CmsListResult,
  CmsSearchQuery,
  CmsSortEntry,
} from "../../cms/types";

interface CmsIndexResponse {
  cms?: CmsConfigState;
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
