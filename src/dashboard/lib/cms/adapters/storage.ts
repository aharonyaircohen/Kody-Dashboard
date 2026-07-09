import path from "node:path";

import type { CmsStorageTransport } from "@dashboard/lib/storage";
import { CmsConfigError, getCollectionIdField } from "../config";
import type {
  CmsCollectionConfig,
  CmsDocument,
  CmsFilterOperator,
  CmsListQuery,
  CmsSortEntry,
} from "../types";
import {
  CmsAdapterError,
  type CmsAdapter,
  type CmsAdapterContext,
} from "./types";

export function createStorageCmsAdapter({
  resolveTransport,
}: {
  resolveTransport: (
    context: CmsAdapterContext,
  ) => CmsStorageTransport | undefined;
}): CmsAdapter {
  return {
    name: "storage",

    async list(context, query) {
      const docs = await readCollectionDocs(
        getTransport(context),
        context.collection,
      );
      const filtered = applyFilters(docs, query.filters ?? {});
      const searched = applySearch(filtered, context.collection, query.search);
      const sorted = applySort(
        searched,
        query.sort ?? context.collection.defaultSort,
      );
      const offset = Math.max(0, Number(query.offset ?? 0));
      const limit = clampLimit(query.limit);
      return {
        docs: sorted.slice(offset, offset + limit),
        total: sorted.length,
        limit,
        offset,
      };
    },

    async listByIds(context, ids) {
      const transport = getTransport(context);
      const docs: CmsDocument[] = [];
      for (const id of ids) {
        const doc = await readDoc(transport, context.collection, id).catch(
          (error) => {
            if (isMissing(error)) return null;
            throw error;
          },
        );
        if (doc) docs.push(doc);
      }
      return docs;
    },

    async get(context, id) {
      return readDoc(getTransport(context), context.collection, id).catch(
        (error) => {
          if (isMissing(error)) return null;
          throw error;
        },
      );
    },

    async create(context, data) {
      const collection = context.collection;
      const id = getDocumentId(collection, data);
      const transport = getTransport(context);
      const existing = await readDoc(transport, collection, id).catch(
        (error) => {
          if (isMissing(error)) return null;
          throw error;
        },
      );
      if (existing) {
        throw new CmsConfigError([`${collection.name}/${id} already exists`]);
      }
      await transport.writeFile(docPath(collection, id), formatDocument(data), {
        message: `cms: create ${collection.name}/${id}`,
      });
      return readDoc(transport, collection, id);
    },

    async update(context, id, data) {
      const collection = context.collection;
      const transport = getTransport(context);
      const current = await readDoc(transport, collection, id).catch(
        (error) => {
          if (isMissing(error)) return null;
          throw error;
        },
      );
      if (!current) return null;

      const idField = getCollectionIdField(collection);
      if (data[idField] !== undefined && String(data[idField]) !== String(id)) {
        throw new CmsConfigError([
          `${collection.name} update cannot change ${idField}`,
        ]);
      }

      const next = { ...current, ...data };
      await transport.writeFile(docPath(collection, id), formatDocument(next), {
        message: `cms: update ${collection.name}/${id}`,
      });
      return readDoc(transport, collection, id);
    },

    async delete(context, id) {
      try {
        await getTransport(context).deleteFile(
          docPath(context.collection, id),
          {
            message: `cms: delete ${context.collection.name}/${id}`,
          },
        );
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },
  };

  function getTransport(context: CmsAdapterContext): CmsStorageTransport {
    const transport = context.transport ?? resolveTransport(context);
    if (!transport) {
      throw new CmsAdapterError(
        "cms_storage_unavailable",
        "CMS storage adapter requires a storage transport.",
        500,
      );
    }
    return transport;
  }
}

async function readCollectionDocs(
  transport: CmsStorageTransport,
  collection: CmsCollectionConfig,
): Promise<CmsDocument[]> {
  const rootPath = collectionPath(collection);
  const files = await transport.listFiles(rootPath).catch((error) => {
    if (isMissing(error)) return [];
    throw error;
  });
  const extension = getExtension(collection);
  const docs: CmsDocument[] = [];
  for (const filePath of files.filter((file) =>
    file.endsWith(`.${extension}`),
  )) {
    docs.push(JSON.parse(await transport.readFile(filePath)) as CmsDocument);
  }
  return docs;
}

async function readDoc(
  transport: CmsStorageTransport,
  collection: CmsCollectionConfig,
  id: string,
): Promise<CmsDocument> {
  return JSON.parse(
    await transport.readFile(docPath(collection, id)),
  ) as CmsDocument;
}

function applyFilters(
  docs: CmsDocument[],
  filters: NonNullable<CmsListQuery["filters"]>,
): CmsDocument[] {
  const entries = Object.entries(filters);
  if (entries.length === 0) return docs;
  return docs.filter((doc) =>
    entries.every(([field, operators]) =>
      Object.entries(operators).every(([operator, expected]) =>
        matchesFilter(doc[field], operator as CmsFilterOperator, expected),
      ),
    ),
  );
}

function matchesFilter(
  actual: unknown,
  operator: CmsFilterOperator,
  expected: unknown,
): boolean {
  if (operator === "equals") return actual === expected;
  if (operator === "not_equals") return actual !== expected;
  if (operator === "contains") {
    return String(actual ?? "")
      .toLowerCase()
      .includes(String(expected ?? "").toLowerCase());
  }
  if (operator === "in") {
    return Array.isArray(expected) && expected.includes(actual);
  }
  if (operator === "exists") return expected ? actual != null : actual == null;
  if (operator === "greater_than") return compare(actual, expected) > 0;
  if (operator === "greater_than_equal") return compare(actual, expected) >= 0;
  if (operator === "less_than") return compare(actual, expected) < 0;
  if (operator === "less_than_equal") return compare(actual, expected) <= 0;
  return true;
}

function applySearch(
  docs: CmsDocument[],
  collection: CmsCollectionConfig,
  search: CmsListQuery["search"],
): CmsDocument[] {
  const query = search?.query?.trim();
  if (!query) return docs;
  const fields = search?.fields?.length
    ? search.fields
    : collection.searchFields.length
      ? collection.searchFields
      : [collection.titleField].filter((field): field is string =>
          Boolean(field),
        );
  if (fields.length === 0) return docs;
  const needle = query.toLowerCase();
  return docs.filter((doc) =>
    fields.some((field) =>
      String(doc[field] ?? "")
        .toLowerCase()
        .includes(needle),
    ),
  );
}

function applySort(
  docs: CmsDocument[],
  sort: CmsSortEntry[] | undefined,
): CmsDocument[] {
  if (!sort || sort.length === 0) return docs;
  return [...docs].sort((left, right) => {
    for (const entry of sort) {
      const compared = compare(left[entry.field], right[entry.field]);
      if (compared !== 0) {
        return entry.direction === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function getDocumentId(
  collection: CmsCollectionConfig,
  data: CmsDocument,
): string {
  const idField = getCollectionIdField(collection);
  const id = data[idField] ?? data.id;
  if (id == null || String(id).trim() === "") {
    throw new CmsConfigError([`${collection.name} create requires an id`]);
  }
  return String(id);
}

function docPath(collection: CmsCollectionConfig, id: string): string {
  return safeJoin(
    collectionPath(collection),
    `${safeDocumentId(id)}.${getExtension(collection)}`,
  );
}

function collectionPath(collection: CmsCollectionConfig): string {
  return safeJoin(
    stringValue(collection.source?.path) ??
      stringValue(collection.source?.collection) ??
      collection.name,
  );
}

function getExtension(collection: CmsCollectionConfig): string {
  const extension = stringValue(collection.source?.extension) ?? "json";
  if (!/^[A-Za-z0-9]+$/.test(extension)) {
    throw new CmsConfigError([`unsafe file extension: ${extension}`]);
  }
  if (extension !== "json") {
    throw new CmsConfigError([
      "Storage CMS adapter only supports json documents",
    ]);
  }
  return extension;
}

function formatDocument(document: CmsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function safeDocumentId(id: string): string {
  return encodeURIComponent(id);
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
    throw new CmsConfigError(["resolved storage path escapes root"]);
  }
  return normalized;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampLimit(value: unknown): number {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function isMissing(error: unknown): boolean {
  return (error as { status?: number })?.status === 404;
}
