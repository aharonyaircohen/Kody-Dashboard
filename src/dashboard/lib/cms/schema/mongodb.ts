import "server-only";

import { MongoClient, ObjectId, type Document } from "mongodb";

import type {
  CmsCollectionConfig,
  CmsFilterConfig,
  CmsFieldConfig,
  CmsFieldOption,
  CmsFieldStorageKind,
  CmsFieldType,
  CmsSortEntry,
  CmsViewFieldConfig,
} from "@dashboard/lib/cms/types";
import type { StateRepoWriteFile } from "@dashboard/lib/state-repo";

const SYSTEM_FIELDS = new Set(["_id", "__v", "createdAt", "updatedAt"]);
const SENSITIVE_RE =
  /(password|secret|token|hash|salt|session|ipHash|userAgentHash)/i;
const TEXT_SEARCH_RE =
  /(title|name|label|email|slug|code|key|status|type|kind|role|locale|currency|provider|description|filename|adminTitle)$/i;
const TITLE_FIELD_CANDIDATES = [
  "title",
  "name",
  "label",
  "adminTitle",
  "email",
  "code",
  "key",
  "slug",
  "_id",
];

interface FieldStats {
  name: string;
  presence: number;
  types: Set<string>;
  stringValues: Set<string>;
  arrayValues: unknown[];
  maxStringLength: number;
}

interface CollectionStats {
  collectionName: string;
  count: number;
  fields: FieldStats[];
}

interface GenerateMongoCmsSchemaOptions {
  uri: string;
  databaseUriSecret: string;
  databaseName?: string;
  repoName: string;
  cmsName: string;
  environment: string;
  sampleSize: number;
  skipCollections: string[];
}

export interface GeneratedMongoCmsSchema {
  files: StateRepoWriteFile[];
  collectionCount: number;
}

export async function generateMongoCmsSchemaFiles(
  options: GenerateMongoCmsSchemaOptions,
): Promise<GeneratedMongoCmsSchema> {
  const client = new MongoClient(options.uri);
  await client.connect();

  try {
    const db = options.databaseName
      ? client.db(options.databaseName)
      : client.db();
    const skipCollections = new Set(options.skipCollections);
    const collectionNames = (await db.listCollections().toArray())
      .map((collection) => collection.name)
      .filter((name) => !shouldSkipCollection(name, skipCollections))
      .sort((left, right) => left.localeCompare(right));

    const rawStats = new Map<string, CollectionStats>();
    for (const collectionName of collectionNames) {
      const docs = await db
        .collection(collectionName)
        .find({})
        .limit(options.sampleSize)
        .toArray();
      rawStats.set(collectionName, analyzeCollection(collectionName, docs));
    }

    const titleFields = new Map<string, string>();
    for (const collectionName of collectionNames) {
      const stats = rawStats.get(collectionName);
      if (stats) titleFields.set(collectionName, inferTitleField(stats));
    }

    const collectionFiles: StateRepoWriteFile[] = [];
    const collectionRefs: string[] = [];
    for (const collectionName of collectionNames) {
      const stats = rawStats.get(collectionName);
      if (!stats) continue;
      const generated = buildCollectionConfig({
        collectionName,
        collectionNames,
        stats,
        titleFields,
      });
      const filePath = `cms/collections/${collectionName}.json`;
      collectionFiles.push({
        path: filePath,
        content: toJson(generated),
      });
      collectionRefs.push(`collections/${collectionName}.json`);
    }

    return {
      collectionCount: collectionFiles.length,
      files: [
        {
          path: `cms/environments/${options.environment}.json`,
          content: toJson({
            name: options.environment,
            adapter: "mongodb",
            databaseUriSecret: options.databaseUriSecret,
            ...(options.databaseName
              ? { databaseName: options.databaseName }
              : {}),
            writePolicy: "enabled",
          }),
        },
        ...collectionFiles,
        {
          path: "cms/config.json",
          content: toJson({
            version: 1,
            name: options.cmsName,
            environment: options.environment,
            environmentFile: `environments/${options.environment}.json`,
            defaultAdapter: "mongodb",
            writePolicy: "enabled",
            collections: collectionRefs,
          }),
        },
      ],
    };
  } finally {
    await client.close();
  }
}

function buildCollectionConfig({
  collectionName,
  collectionNames,
  stats,
  titleFields,
}: {
  collectionName: string;
  collectionNames: string[];
  stats: CollectionStats;
  titleFields: Map<string, string>;
}): CmsCollectionConfig {
  const titleField = titleFields.get(collectionName);
  const fields = stats.fields.map((fieldStats) =>
    buildFieldConfig(fieldStats, collectionNames, titleFields),
  );
  const fieldByName = new Map(fields.map((field) => [field.name, field]));
  const searchFields = inferSearchFields(fields, titleField);
  const listFields = inferListFields(fields, titleField, searchFields);
  const filterFields = listFields
    .map((entry) => fieldByName.get(entry.name))
    .filter((field): field is CmsFieldConfig => Boolean(field));
  const filters = inferFilters(filterFields);

  return {
    name: collectionName,
    label: titleize(collectionName),
    adapter: "mongodb",
    mcpName: toMcpName(collectionName),
    source: {
      collection: collectionName,
      idField: "_id",
    },
    titleField,
    searchFields,
    writePolicy: "enabled",
    operations: {
      list: true,
      get: true,
      search: true,
      create: true,
      update: true,
      delete: true,
    },
    defaultSort: inferDefaultSort(fieldByName),
    fields,
    views: {
      list: { fields: listFields },
      detail: {
        fields: fields
          .filter((field) => !field.hidden)
          .map((field) => ({ name: field.name })),
      },
      form: {
        fields: fields
          .filter(
            (field) => !field.hidden && !field.readOnly && field.type !== "id",
          )
          .map((field) => ({ name: field.name })),
      },
    },
    filters,
  };
}

function buildFieldConfig(
  fieldStats: FieldStats,
  collectionNames: string[],
  titleFields: Map<string, string>,
): CmsFieldConfig {
  const name = fieldStats.name;
  const base: CmsFieldConfig = {
    name,
    type: inferFieldType(fieldStats, name),
    label: labelForField(name),
    storage: inferFieldStorage(fieldStats, name),
  };

  if (name === "_id")
    return {
      ...base,
      type: "id",
      label: "ID",
      readOnly: true,
      storage: { kind: "objectId" },
    };
  if (name === "__v") {
    return {
      ...base,
      type: "number",
      label: "Version",
      readOnly: true,
      hidden: true,
    };
  }
  if (name === "createdAt" || name === "updatedAt") {
    return { ...base, type: "date", readOnly: true, storage: { kind: "date" } };
  }
  if (SENSITIVE_RE.test(name)) base.hidden = true;

  const relationTarget = inferRelationTarget(name, base.type, collectionNames);
  if (relationTarget) {
    const targetTitleField = titleFields.get(relationTarget);
    return {
      ...base,
      type: base.type,
      target: relationTarget,
      storage: {
        kind: base.type === "relationMany" ? "objectIdArray" : "objectId",
      },
      ...(targetTitleField ? { labelField: targetTitleField } : {}),
    };
  }
  if (base.type === "relation") base.type = "text";
  if (base.type === "relationMany") base.type = "array";
  if (base.type === "select" || base.type === "multiSelect") {
    const options = inferOptions(fieldStats);
    if (options.length > 0) base.options = options;
  }

  return base;
}

function inferFieldType(
  fieldStats: FieldStats,
  fieldName: string,
): CmsFieldType {
  if (fieldName === "_id") return "id";
  if (fieldStats.types.has("array")) {
    if (arrayLooksLikeObjectIds(fieldStats)) return "relationMany";
    if (arrayLooksLikeEnum(fieldStats)) return "multiSelect";
    return "array";
  }
  if (fieldStats.types.has("objectId")) return "relation";
  if (fieldStats.types.has("date") || looksLikeDateField(fieldName))
    return "date";
  if (fieldStats.types.has("boolean")) return "boolean";
  if (fieldStats.types.has("number")) return "number";
  if (fieldStats.types.has("object")) return "object";
  if (stringLooksLikeObjectIdRelation(fieldStats, fieldName)) return "relation";
  if (stringLooksLikeEnum(fieldStats, fieldName)) return "select";
  if (stringLooksLikeTextarea(fieldStats, fieldName)) return "textarea";
  return "text";
}

function inferFieldStorage(
  fieldStats: FieldStats,
  fieldName: string,
): { kind: CmsFieldStorageKind } | undefined {
  if (fieldName === "_id" || fieldStats.types.has("objectId")) {
    return { kind: "objectId" };
  }
  if (fieldStats.types.has("array")) {
    if (arrayLooksLikeObjectIds(fieldStats)) return { kind: "objectIdArray" };
    if (arrayLooksLikeEnum(fieldStats)) return { kind: "stringArray" };
    return { kind: "array" };
  }
  if (fieldStats.types.has("date")) {
    return { kind: "date" };
  }
  if (looksLikeDateField(fieldName) && fieldStats.types.has("string")) {
    return { kind: "dateString" };
  }
  if (fieldStats.types.has("boolean")) return { kind: "boolean" };
  if (fieldStats.types.has("number")) return { kind: "number" };
  if (fieldStats.types.has("object")) return { kind: "object" };
  if (stringLooksLikeObjectIdRelation(fieldStats, fieldName)) {
    return { kind: "objectId" };
  }
  return undefined;
}

function inferTitleField(stats: CollectionStats): string {
  const fieldNames = new Set(stats.fields.map((field) => field.name));
  for (const candidate of TITLE_FIELD_CANDIDATES) {
    if (fieldNames.has(candidate)) return candidate;
  }
  const textField = stats.fields.find((field) => field.types.has("string"));
  return textField?.name ?? "_id";
}

function inferSearchFields(
  fields: CmsFieldConfig[],
  titleField: string | undefined,
): string[] {
  const result: string[] = [];
  const add = (name: string | undefined) => {
    if (!name || result.includes(name)) return;
    const field = fields.find((candidate) => candidate.name === name);
    if (!field || field.hidden) return;
    if (!["text", "textarea", "select"].includes(field.type)) return;
    result.push(name);
  };

  add(titleField);
  for (const field of fields) {
    if (TEXT_SEARCH_RE.test(field.name) || /label/i.test(field.name)) {
      add(field.name);
    }
  }
  return result.slice(0, 8);
}

function inferListFields(
  fields: CmsFieldConfig[],
  titleField: string | undefined,
  searchFields: string[],
): CmsViewFieldConfig[] {
  const result: CmsViewFieldConfig[] = [];
  const add = (
    name: string | undefined,
    view: Partial<CmsViewFieldConfig> = {},
  ) => {
    if (!name || result.some((entry) => entry.name === name)) return;
    const field = fields.find((candidate) => candidate.name === name);
    if (!field || field.hidden || !isCompactListField(field)) return;
    result.push({ name, ...view });
  };

  add(titleField, { role: "primary", width: "fill" });
  for (const field of fields
    .filter((field) => !SYSTEM_FIELDS.has(field.name))
    .filter((field) => field.name !== titleField)
    .filter((field) => !field.hidden && isCompactListField(field))
    .sort((left, right) =>
      compareListFieldPriority(left, right, searchFields),
    )) {
    if (result.length >= 6) break;
    add(field.name);
  }
  for (const name of ["updatedAt", "createdAt"]) add(name);

  return result.slice(0, 6);
}

function compareListFieldPriority(
  left: CmsFieldConfig,
  right: CmsFieldConfig,
  searchFields: string[],
): number {
  const leftScore = listFieldPriority(left, searchFields);
  const rightScore = listFieldPriority(right, searchFields);
  if (leftScore !== rightScore) return leftScore - rightScore;
  return left.name.localeCompare(right.name);
}

function listFieldPriority(
  field: CmsFieldConfig,
  searchFields: string[],
): number {
  if (searchFields.includes(field.name)) return 0;
  if (field.type === "relation") return 10;
  if (field.type === "select" || field.type === "boolean") return 20;
  if (field.type === "date" || field.type === "number") return 30;
  return 40;
}

function inferFilters(fields: CmsFieldConfig[]): CmsFilterConfig[] {
  const filters: CmsFilterConfig[] = [];
  for (const field of fields) {
    if (field.hidden || field.type === "id") continue;
    if (field.type === "text" || field.type === "textarea") {
      filters.push({ field: field.name, operators: ["contains", "equals"] });
      continue;
    }
    if (field.type === "select") {
      filters.push({ field: field.name, operators: ["equals", "in"] });
      continue;
    }
    if (field.type === "multiSelect" || field.type === "relationMany") {
      filters.push({ field: field.name, operators: ["in"] });
      continue;
    }
    if (field.type === "relation" || field.type === "boolean") {
      filters.push({ field: field.name, operators: ["equals"] });
      continue;
    }
    if (field.type === "number" || field.type === "date") {
      filters.push({
        field: field.name,
        operators: ["equals", "greater_than_equal", "less_than_equal"],
      });
    }
  }
  return filters;
}

function inferDefaultSort(
  fieldByName: Map<string, CmsFieldConfig>,
): CmsSortEntry[] {
  if (fieldByName.has("updatedAt"))
    return [{ field: "updatedAt", direction: "desc" }];
  if (fieldByName.has("createdAt"))
    return [{ field: "createdAt", direction: "desc" }];
  return [];
}

function inferRelationTarget(
  fieldName: string,
  fieldType: CmsFieldType,
  collectionNames: string[],
): string | null {
  if (fieldType !== "relation" && fieldType !== "relationMany") return null;
  const normalized = normalizeRelationName(fieldName);
  const variants = relationNameVariants(normalized);
  for (const collection of collectionNames) {
    const normalizedCollection = normalizeRelationName(collection);
    if (variants.includes(normalizedCollection)) return collection;
  }
  return null;
}

function relationNameVariants(normalized: string): string[] {
  const names = new Set<string>();
  const add = (value: string) => {
    if (!value) return;
    names.add(value);
    names.add(`${value}s`);
    names.add(`${value}es`);
    names.add(value.replace(/y$/, "ies"));
  };
  add(normalized);
  for (const prefix of ["related", "linked", "selected", "assigned"]) {
    if (normalized.startsWith(prefix)) {
      add(normalized.slice(prefix.length));
    }
  }
  return [...names];
}

function analyzeCollection(
  collectionName: string,
  docs: Document[],
): CollectionStats {
  const fields = new Map<string, FieldStats>();
  const ensure = (name: string) => {
    if (!fields.has(name)) {
      fields.set(name, {
        name,
        presence: 0,
        types: new Set(),
        stringValues: new Set(),
        arrayValues: [],
        maxStringLength: 0,
      });
    }
    return fields.get(name)!;
  };

  ensure("_id");
  for (const doc of docs) {
    for (const [name, value] of Object.entries(doc)) {
      const field = ensure(name);
      if (value === undefined || value === null) continue;
      field.presence += 1;
      recordValue(field, value);
    }
  }

  return {
    collectionName,
    count: docs.length,
    fields: [...fields.values()].sort(compareFields),
  };
}

function recordValue(field: FieldStats, value: unknown): void {
  if (value instanceof ObjectId) {
    field.types.add("objectId");
    return;
  }
  if (value instanceof Date) {
    field.types.add("date");
    return;
  }
  if (Array.isArray(value)) {
    field.types.add("array");
    for (const item of value) {
      field.arrayValues.push(item);
      if (typeof item === "string") field.stringValues.add(item);
    }
    return;
  }

  const type = typeof value;
  if (typeof value === "string") {
    field.types.add("string");
    field.maxStringLength = Math.max(field.maxStringLength, value.length);
    if (field.stringValues.size < 80) field.stringValues.add(value);
    return;
  }
  if (type === "number") {
    field.types.add("number");
    return;
  }
  if (type === "boolean") {
    field.types.add("boolean");
    return;
  }
  if (type === "object") field.types.add("object");
}

function compareFields(a: FieldStats, b: FieldStats): number {
  const priority = ["_id", "title", "name", "label", "status", "order"];
  const aIndex = priority.indexOf(a.name);
  const bIndex = priority.indexOf(b.name);
  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  }
  if (SYSTEM_FIELDS.has(a.name) && !SYSTEM_FIELDS.has(b.name)) return 1;
  if (!SYSTEM_FIELDS.has(a.name) && SYSTEM_FIELDS.has(b.name)) return -1;
  return a.name.localeCompare(b.name);
}

function arrayLooksLikeObjectIds(fieldStats: FieldStats): boolean {
  const samples = fieldStats.arrayValues.filter((value) => value !== null);
  return (
    samples.length > 0 &&
    samples.every(
      (value) => value instanceof ObjectId || isObjectIdString(value),
    )
  );
}

function arrayLooksLikeEnum(fieldStats: FieldStats): boolean {
  const samples = fieldStats.arrayValues.filter(
    (value): value is string => typeof value === "string",
  );
  return samples.length > 0 && new Set(samples).size <= 20;
}

function stringLooksLikeObjectIdRelation(
  fieldStats: FieldStats,
  fieldName: string,
): boolean {
  const values = [...fieldStats.stringValues].filter(Boolean);
  return (
    fieldStats.types.has("string") &&
    values.length > 0 &&
    /(?:Id|ID|[._-]id)$/.test(fieldName) &&
    values.every(isObjectIdString)
  );
}

function stringLooksLikeEnum(
  fieldStats: FieldStats,
  fieldName: string,
): boolean {
  if (!fieldStats.types.has("string")) return false;
  if (
    !/(status|type|kind|role|locale|currency|provider|access|visibility|state)$/i.test(
      fieldName,
    )
  ) {
    return false;
  }
  return fieldStats.stringValues.size > 0 && fieldStats.stringValues.size <= 20;
}

function stringLooksLikeTextarea(
  fieldStats: FieldStats,
  fieldName: string,
): boolean {
  if (!fieldStats.types.has("string")) return false;
  return (
    fieldStats.maxStringLength > 160 ||
    /(description|content|body|notes|message|prompt|summary|meta)$/i.test(
      fieldName,
    )
  );
}

function inferOptions(fieldStats: FieldStats): CmsFieldOption[] {
  return [...fieldStats.stringValues]
    .filter((value) => value !== "")
    .sort((a, b) => String(a).localeCompare(String(b)))
    .slice(0, 50)
    .map((value) => ({ label: value, value }));
}

function looksLikeDateField(fieldName: string): boolean {
  return /(At|Date|Until|Expires|From|To)$/i.test(fieldName);
}

function isCompactListField(field: CmsFieldConfig): boolean {
  return ![
    "array",
    "json",
    "object",
    "textarea",
    "relationMany",
    "multiSelect",
  ].includes(field.type);
}

function normalizeRelationName(name: string): string {
  return String(name)
    .replace(/(?:Id|Ids)$/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

function isObjectIdString(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
}

function shouldSkipCollection(
  name: string,
  skipCollections: Set<string>,
): boolean {
  return (
    skipCollections.has(name) ||
    /^_.*_versions$/.test(name) ||
    name.endsWith("_versions")
  );
}

function labelForField(value: string): string {
  if (value === "_id") return "ID";
  if (value === "__v") return "Version";
  return titleize(value);
}

function titleize(value: string): string {
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toMcpName(collectionName: string): string {
  return String(collectionName).replace(/[^A-Za-z0-9_]/g, "_");
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
