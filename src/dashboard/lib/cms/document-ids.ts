import type { CmsCollectionConfig, CmsDocument, CmsListResult } from "./types";

export function annotateCmsListResult(
  collection: CmsCollectionConfig,
  result: CmsListResult,
) {
  const idField = getCollectionIdField(collection);
  return {
    ...result,
    collection: collection.name,
    idField,
    docs: result.docs.map((document) =>
      annotateCmsDocument(collection, document),
    ),
  };
}

export function annotateCmsDocument(
  collection: CmsCollectionConfig,
  document: CmsDocument | null,
): CmsDocument | null {
  if (!document) return null;
  const cmsDocumentId = getCmsDocumentId(collection, document);
  return cmsDocumentId ? { ...document, cmsDocumentId } : document;
}

export function getCmsDocumentId(
  collection: CmsCollectionConfig,
  document: CmsDocument,
): string | null {
  return stringifyCmsDocumentId(
    document[getCollectionIdField(collection)] ?? document.id ?? document._id,
  );
}

export function getCollectionIdField(collection: CmsCollectionConfig): string {
  return collection.source.idField ?? "_id";
}

export function normalizeCmsDocumentIdInput(input: string): string {
  const trimmed = stripWrappingQuotes(input.trim());
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  const path = parseDocumentPath(withoutQuery);
  return path ?? parseDocumentIdSegment(withoutQuery) ?? withoutQuery;
}

function stringifyCmsDocumentId(value: unknown): string | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? id : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (
    value &&
    typeof value === "object" &&
    "toHexString" in value &&
    typeof value.toHexString === "function"
  ) {
    return value.toHexString();
  }
  return null;
}

function stripWrappingQuotes(value: string): string {
  let current = value;
  for (;;) {
    const next = current.replace(/^[`'"]+|[`'"]+$/g, "").trim();
    if (next === current) return current;
    current = next;
  }
}

function parseDocumentPath(value: string): string | null {
  const path =
    value.startsWith("http://") || value.startsWith("https://")
      ? urlPathname(value)
      : value;
  if (!path || !path.includes("/content/entries/")) return null;

  const parts = path.split("/").filter(Boolean).map(decodePathPart);
  const entriesIndex = parts.findIndex(
    (part, index) => part === "content" && parts[index + 1] === "entries",
  );
  const idPart = parts[entriesIndex + 3];
  if (!idPart || idPart === "new") return null;
  return idPart === "edit" ? (parts[entriesIndex + 2] ?? null) : idPart;
}

function parseDocumentIdSegment(value: string): string | null {
  const parts = value.split("/").filter(Boolean).map(decodePathPart);
  if (parts.length < 2) return null;
  const lastPart = parts[parts.length - 1];
  if (!lastPart || lastPart === "new") return null;
  return lastPart === "edit" ? (parts[parts.length - 2] ?? null) : lastPart;
}

function urlPathname(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
