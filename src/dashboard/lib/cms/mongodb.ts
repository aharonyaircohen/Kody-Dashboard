import "server-only";

import { createHash } from "node:crypto";
import {
  MongoClient,
  ObjectId,
  type Document,
  type Filter,
  type Sort,
} from "mongodb";

import {
  CmsConfigError,
  getCollectionIdField,
  normalizeFilters,
} from "@dashboard/lib/cms/config";
import type {
  CmsCollectionConfig,
  CmsDocument,
  CmsFieldConfig,
  CmsListQuery,
  CmsListResult,
  CmsRuntimeConfig,
  CmsSearchQuery,
  CmsSortEntry,
} from "@dashboard/lib/cms/types";

type MongoClientCache = typeof globalThis & {
  __kodyCmsMongoClients?: Map<string, Promise<MongoClient>>;
};

export async function listMongoDocuments(options: {
  uri: string;
  databaseName?: string;
  config: CmsRuntimeConfig;
  collection: CmsCollectionConfig;
  query: CmsListQuery;
}): Promise<CmsListResult> {
  const mongoCollection = await getMongoCollection(options);
  const filter = buildMongoQuery(
    options.collection,
    options.query.filters ?? {},
    options.query.search,
  );
  const limit = clampLimit(options.query.limit);
  const offset = Math.max(0, Number(options.query.offset ?? 0));
  const sort = buildMongoSort(
    options.query.sort ?? options.collection.defaultSort,
  );
  const projection = buildProjection(options.collection);
  const cursor = mongoCollection.find(filter, { projection });

  if (sort) cursor.sort(sort);
  cursor.skip(offset).limit(limit);

  const [docs, total] = await Promise.all([
    cursor.toArray(),
    mongoCollection.countDocuments(filter),
  ]);

  return {
    docs: docs.map((doc: Document) =>
      normalizeMongoDocument(doc, options.collection),
    ),
    total,
    limit,
    offset,
  };
}

export async function getMongoDocument(options: {
  uri: string;
  databaseName?: string;
  config: CmsRuntimeConfig;
  collection: CmsCollectionConfig;
  id: string;
}): Promise<CmsDocument | null> {
  const mongoCollection = await getMongoCollection(options);
  const doc = await mongoCollection.findOne(
    buildIdQuery(options.collection, options.id),
    {
      projection: buildProjection(options.collection),
    },
  );
  return doc ? normalizeMongoDocument(doc, options.collection) : null;
}

export async function createMongoDocument(options: {
  uri: string;
  databaseName?: string;
  config: CmsRuntimeConfig;
  collection: CmsCollectionConfig;
  data: CmsDocument;
}): Promise<CmsDocument> {
  const mongoCollection = await getMongoCollection(options);
  const payload = buildMongoWriteDocument(options.collection, options.data, {
    requireRequiredFields: true,
  });
  const result = await mongoCollection.insertOne(payload);
  const created = await mongoCollection.findOne(
    { _id: result.insertedId },
    {
      projection: buildProjection(options.collection),
    },
  );
  return normalizeMongoDocument(
    created ?? { ...payload, _id: result.insertedId },
    options.collection,
  );
}

export async function updateMongoDocument(options: {
  uri: string;
  databaseName?: string;
  config: CmsRuntimeConfig;
  collection: CmsCollectionConfig;
  id: string;
  data: CmsDocument;
}): Promise<CmsDocument | null> {
  const mongoCollection = await getMongoCollection(options);
  const payload = buildMongoWriteDocument(options.collection, options.data, {
    requireRequiredFields: false,
  });
  const filter = buildIdQuery(options.collection, options.id);

  if (Object.keys(payload).length > 0) {
    await mongoCollection.updateOne(filter, { $set: payload });
  }

  const updated = await mongoCollection.findOne(filter, {
    projection: buildProjection(options.collection),
  });
  return updated ? normalizeMongoDocument(updated, options.collection) : null;
}

export async function deleteMongoDocument(options: {
  uri: string;
  databaseName?: string;
  config: CmsRuntimeConfig;
  collection: CmsCollectionConfig;
  id: string;
}): Promise<boolean> {
  const mongoCollection = await getMongoCollection(options);
  const result = await mongoCollection.deleteOne(
    buildIdQuery(options.collection, options.id),
  );
  return result.deletedCount > 0;
}

export function buildMongoQuery(
  collection: CmsCollectionConfig,
  filters: unknown,
  search?: CmsSearchQuery,
): Filter<Document> {
  const normalized = normalizeFilters(collection, filters);
  const query: Filter<Document> = {};
  const fields = new Map(collection.fields.map((field) => [field.name, field]));

  for (const [fieldName, operators] of Object.entries(normalized)) {
    const field = fields.get(fieldName);
    if (!field) continue;

    for (const [operator, rawValue] of Object.entries(operators)) {
      const value = coerceMongoValue(field, rawValue);
      if (operator === "equals") {
        query[fieldName] = coerceMongoEqualityValue(field, rawValue);
      }
      if (operator === "not_equals") {
        query[fieldName] = { ...asObject(query[fieldName]), $ne: value };
      }
      if (operator === "contains") {
        query[fieldName] = {
          $regex: escapeRegex(String(rawValue ?? "")),
          $options: "i",
        };
      }
      if (operator === "in") {
        query[fieldName] = {
          $in: coerceMongoInValues(field, rawValue),
        };
      }
      if (operator === "exists") {
        query[fieldName] = { $exists: Boolean(value) };
      }
      if (operator === "greater_than") {
        query[fieldName] = { ...asObject(query[fieldName]), $gt: value };
      }
      if (operator === "greater_than_equal") {
        query[fieldName] = { ...asObject(query[fieldName]), $gte: value };
      }
      if (operator === "less_than") {
        query[fieldName] = { ...asObject(query[fieldName]), $lt: value };
      }
      if (operator === "less_than_equal") {
        query[fieldName] = { ...asObject(query[fieldName]), $lte: value };
      }
    }
  }

  const searchQuery = buildMongoSearchQuery(collection, search);
  if (!searchQuery) return query;
  if (Object.keys(query).length === 0) return searchQuery;
  return { $and: [query, searchQuery] };
}

function buildMongoSearchQuery(
  collection: CmsCollectionConfig,
  search: CmsSearchQuery | undefined,
): Filter<Document> | null {
  const query = search?.query?.trim();
  if (!query) return null;
  const fields = search?.fields?.length
    ? search.fields
    : collection.searchFields;
  if (fields.length === 0) return null;
  return {
    $or: fields.map((field) => ({
      [field]: { $regex: escapeRegex(query), $options: "i" },
    })),
  };
}

export function normalizeMongoValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (isObjectIdLike(value)) return value.toHexString();
  if (Array.isArray(value))
    return value.map((item) => normalizeMongoValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeMongoValue(child),
      ]),
    );
  }
  return value;
}

async function getMongoCollection(options: {
  uri: string;
  databaseName?: string;
  collection: CmsCollectionConfig;
}) {
  const client = await getMongoClient(options.uri);
  const collectionName =
    options.collection.source.collection ?? options.collection.name;
  return getMongoDatabase(client, options.databaseName).collection(
    collectionName,
  );
}

export function getMongoDatabase(
  client: Pick<MongoClient, "db">,
  databaseName?: string,
) {
  return databaseName ? client.db(databaseName) : client.db();
}

async function getMongoClient(uri: string): Promise<MongoClient> {
  const globalCache = globalThis as MongoClientCache;
  globalCache.__kodyCmsMongoClients ??= new Map();
  const key = createHash("sha256").update(uri).digest("hex");
  let clientPromise = globalCache.__kodyCmsMongoClients.get(key);

  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
    globalCache.__kodyCmsMongoClients.set(key, clientPromise);
    return clientPromise;
  }

  return clientPromise;
}

function normalizeMongoDocument(
  doc: Document,
  collection: CmsCollectionConfig,
): CmsDocument {
  const normalized = normalizeMongoValue(doc) as CmsDocument;
  const idField = getCollectionIdField(collection);
  if (
    idField !== "id" &&
    normalized.id === undefined &&
    normalized[idField] != null
  ) {
    normalized.id = normalized[idField];
  }
  return normalized;
}

function buildIdQuery(
  collection: CmsCollectionConfig,
  id: string,
): Filter<Document> {
  const idField = getCollectionIdField(collection);
  if (/^[a-f0-9]{24}$/i.test(id)) {
    return { [idField]: { $in: [new ObjectId(id), id] } };
  }
  return { [idField]: id };
}

function buildMongoSort(sortEntries: CmsSortEntry[]): Sort | undefined {
  if (!sortEntries.length) return undefined;
  return Object.fromEntries(
    sortEntries.map((entry) => [
      entry.field,
      entry.direction === "asc" ? 1 : -1,
    ]),
  ) as Sort;
}

function buildProjection(collection: CmsCollectionConfig): Record<string, 1> {
  const projection: Record<string, 1> = {};
  for (const field of collection.fields) {
    if (!field.hidden) projection[field.name] = 1;
  }
  const idField = getCollectionIdField(collection);
  projection[idField] = 1;
  projection._id = 1;
  return projection;
}

export function buildMongoWriteDocument(
  collection: CmsCollectionConfig,
  value: CmsDocument,
  options: { requireRequiredFields: boolean },
): Document {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CmsConfigError(["CMS document body must be an object."]);
  }

  const idField = getCollectionIdField(collection);
  const fieldsByName = new Map(
    collection.fields.map((field) => [field.name, field]),
  );
  const writableFields = collection.fields.filter(
    (field) =>
      !field.hidden &&
      !field.readOnly &&
      field.type !== "id" &&
      field.name !== idField,
  );
  const writableNames = new Set(writableFields.map((field) => field.name));
  const payload: Document = {};

  for (const key of Object.keys(value)) {
    const field = fieldsByName.get(key);
    if (!field || !writableNames.has(key)) {
      throw new CmsConfigError([`field is not writable: ${key}`]);
    }
  }

  for (const field of writableFields) {
    const rawValue = value[field.name];
    if (rawValue === undefined) {
      if (options.requireRequiredFields && field.required) {
        throw new CmsConfigError([`missing required field: ${field.name}`]);
      }
      continue;
    }

    payload[field.name] = coerceMongoValue(field, rawValue);
  }

  return payload;
}

function coerceMongoValue(field: CmsFieldConfig, value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item) => coerceMongoValue(field, item));
  if (field.type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  if (field.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
    return value;
  }
  if (field.type === "date" && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (
    (field.type === "id" ||
      field.type === "relation" ||
      field.type === "relationMany") &&
    typeof value === "string" &&
    /^[a-f0-9]{24}$/i.test(value)
  ) {
    return new ObjectId(value);
  }
  return value;
}

function coerceMongoEqualityValue(
  field: CmsFieldConfig,
  value: unknown,
): unknown {
  if (
    isObjectIdField(field) &&
    typeof value === "string" &&
    /^[a-f0-9]{24}$/i.test(value)
  ) {
    return { $in: [new ObjectId(value), value] };
  }
  return coerceMongoValue(field, value);
}

function coerceMongoInValues(field: CmsFieldConfig, value: unknown): unknown[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (
      isObjectIdField(field) &&
      typeof item === "string" &&
      /^[a-f0-9]{24}$/i.test(item)
    ) {
      return [new ObjectId(item), item];
    }
    return [coerceMongoValue(field, item)];
  });
}

function isObjectIdField(field: CmsFieldConfig): boolean {
  return (
    field.type === "id" ||
    field.type === "relation" ||
    field.type === "relationMany"
  );
}

function clampLimit(limit: unknown): number {
  const numeric = Number(limit ?? 50);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(1, Math.min(100, numeric));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObjectIdLike(value: unknown): value is { toHexString(): string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "toHexString" in value &&
    typeof (value as { toHexString?: unknown }).toHexString === "function"
  );
}
