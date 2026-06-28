import "server-only";

import type { Octokit } from "@octokit/rest";

import { readStateText } from "@dashboard/lib/state-repo";
import type {
  CmsCollectionConfig,
  CmsContentOperation,
  CmsCollectionOperations,
  CmsCollectionViewsConfig,
  CmsFieldConfig,
  CmsFieldDisplayConfig,
  CmsFieldStorageKind,
  CmsFieldType,
  CmsFieldValidationConfig,
  CmsFilterConfig,
  CmsFilterOperator,
  CmsPublicConfig,
  CmsPermissionsConfig,
  CmsRole,
  CmsRuntimeConfig,
  CmsSchemaOperation,
  CmsSearchQuery,
  CmsSortEntry,
  CmsUnconfiguredConfig,
  CmsViewFieldConfig,
  CmsViewFieldDisplay,
  CmsViewFieldFormat,
  CmsViewFieldRole,
  CmsViewFieldWidth,
  CmsWritePolicy,
} from "./types";

const CMS_CONFIG_VERSION = 1;

const FIELD_TYPES = new Set<CmsFieldType>([
  "id",
  "text",
  "textarea",
  "number",
  "boolean",
  "date",
  "select",
  "multiSelect",
  "relation",
  "relationMany",
  "json",
  "object",
  "array",
]);

const FIELD_STORAGE_KINDS = new Set<CmsFieldStorageKind>([
  "string",
  "stringArray",
  "number",
  "boolean",
  "date",
  "dateString",
  "objectId",
  "objectIdArray",
  "json",
  "object",
  "array",
]);

const SEARCHABLE_FIELD_TYPES = new Set<CmsFieldType>([
  "text",
  "textarea",
  "select",
]);

const FILTER_OPERATORS = new Set<CmsFilterOperator>([
  "equals",
  "not_equals",
  "contains",
  "in",
  "exists",
  "greater_than",
  "greater_than_equal",
  "less_than",
  "less_than_equal",
]);

const WRITE_POLICIES = new Set<CmsWritePolicy>([
  "read-only",
  "approval-required",
  "enabled",
]);

const CMS_ROLES = new Set<CmsRole>(["viewer", "editor", "admin"]);

const CONTENT_OPERATIONS: CmsContentOperation[] = [
  "list",
  "get",
  "search",
  "create",
  "update",
  "delete",
];

const SCHEMA_OPERATIONS: CmsSchemaOperation[] = ["generate", "refresh", "edit"];
const CMS_COLLECTION_SLUG_RE = /^[a-z][a-z0-9_-]*$/;

export const DEFAULT_CMS_PERMISSIONS: {
  content: Record<CmsContentOperation, CmsRole[]>;
  schema: Record<CmsSchemaOperation, CmsRole[]>;
} = {
  content: {
    list: ["viewer", "editor", "admin"],
    get: ["viewer", "editor", "admin"],
    search: ["viewer", "editor", "admin"],
    create: ["editor", "admin"],
    update: ["editor", "admin"],
    delete: ["admin"],
  },
  schema: {
    generate: ["admin"],
    refresh: ["admin"],
    edit: ["admin"],
  },
};

const VIEW_FIELD_ROLES = new Set<CmsViewFieldRole>([
  "primary",
  "secondary",
  "meta",
]);

const VIEW_FIELD_DISPLAYS = new Set<CmsViewFieldDisplay>([
  "value",
  "label",
  "count",
  "json",
]);

const VIEW_FIELD_FORMATS = new Set<CmsViewFieldFormat>([
  "text",
  "date",
  "datetime",
  "number",
  "boolean",
  "json",
]);

const VIEW_FIELD_WIDTHS = new Set<CmsViewFieldWidth>([
  "xs",
  "sm",
  "md",
  "lg",
  "fill",
]);

interface CacheEntry {
  config: CmsRuntimeConfig | null;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<CmsRuntimeConfig | null>>();
const TTL_MS = 60_000;

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

const DEFAULT_READ_ONLY_OPERATIONS: CmsCollectionOperations = {
  list: true,
  get: true,
  search: true,
  create: false,
  update: false,
  delete: false,
};

export class CmsConfigError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: string[];

  constructor(
    issues: string[],
    options: { code?: string; status?: number } = {},
  ) {
    super(issues.join("; "));
    this.name = "CmsConfigError";
    this.code = options.code ?? "cms_config_error";
    this.status = options.status ?? 400;
    this.issues = issues;
  }
}

export function getCollection(
  config: CmsRuntimeConfig,
  collectionName: string,
): CmsCollectionConfig {
  const collection =
    config.collections[collectionName] ??
    config.collections[toCmsCollectionSlugOrNull(collectionName) ?? ""];
  if (!collection) {
    throw new CmsConfigError([`unknown collection: ${collectionName}`]);
  }
  return collection;
}

export function normalizeCmsCollectionSlug(value: string): string {
  return toCmsCollectionSlugOrNull(value) ?? "collection";
}

export function getCollectionIdField(collection: CmsCollectionConfig): string {
  return collection.source.idField ?? "_id";
}

export function assertReadOperationAllowed(
  collection: CmsCollectionConfig,
  operation: "list" | "get" | "search",
  actorRole: CmsRole = "admin",
  permissions: CmsPermissionsConfig = DEFAULT_CMS_PERMISSIONS,
): void {
  if (!collection.operations[operation]) {
    throw new CmsConfigError([`${operation} disabled ${collection.name}`]);
  }
  assertRoleAllowed(
    actorRole,
    collection.permissions?.content?.[operation] ??
      permissions.content?.[operation] ??
      DEFAULT_CMS_PERMISSIONS.content[operation],
    `${operation} ${collection.name}`,
  );
}

export function assertWriteOperationAllowed(
  collection: CmsCollectionConfig,
  operation: "create" | "update" | "delete",
  actorRole: CmsRole = "admin",
  permissions: CmsPermissionsConfig = DEFAULT_CMS_PERMISSIONS,
): void {
  if (!collection.operations[operation]) {
    throw new CmsConfigError([`${operation} disabled ${collection.name}`]);
  }

  if (collection.writePolicy !== "enabled") {
    throw new CmsConfigError(
      [`${operation} requires writePolicy enabled ${collection.name}`],
      { code: "cms_write_disabled", status: 403 },
    );
  }

  assertRoleAllowed(
    actorRole,
    collection.permissions?.content?.[operation] ??
      permissions.content?.[operation] ??
      DEFAULT_CMS_PERMISSIONS.content[operation],
    `${operation} ${collection.name}`,
  );
}

export function assertSchemaOperationAllowed(
  config: CmsRuntimeConfig,
  operation: CmsSchemaOperation,
  actorRole: CmsRole,
): void {
  assertRoleAllowed(
    actorRole,
    config.permissions.schema?.[operation] ??
      DEFAULT_CMS_PERMISSIONS.schema[operation],
    `${operation} CMS schema`,
  );
}

function assertRoleAllowed(
  actorRole: CmsRole,
  allowedRoles: CmsRole[] | undefined,
  action: string,
): void {
  if (actorRole === "admin") return;
  if ((allowedRoles ?? []).includes(actorRole)) return;

  throw new CmsConfigError([`${action} is not allowed for ${actorRole}`], {
    code: "cms_forbidden",
    status: 403,
  });
}

export function toPublicCmsConfig(
  config: CmsRuntimeConfig,
  actorRole?: CmsRole,
): CmsPublicConfig {
  return {
    configured: true,
    version: config.version,
    name: config.name,
    environment: config.environment,
    defaultAdapter: config.defaultAdapter,
    writePolicy: config.writePolicy,
    actorRole,
    permissions: config.permissions,
    adapters: config.adapters,
    collections: Object.values(config.collections),
  };
}

export function toUnconfiguredCmsConfig(): CmsUnconfiguredConfig {
  return {
    configured: false as const,
    collections: [],
  };
}

export function invalidateCmsConfigCache(owner?: string, repo?: string): void {
  if (typeof owner === "string" && typeof repo === "string") {
    const key = cacheKey(owner, repo);
    CACHE.delete(key);
    INFLIGHT.delete(key);
    return;
  }

  CACHE.clear();
  INFLIGHT.clear();
}

export async function loadCmsConfigFromState(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<CmsRuntimeConfig | null> {
  const key = cacheKey(owner, repo);
  const cached = CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const inflight = INFLIGHT.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const rawConfig = await readStateJson(
      octokit,
      owner,
      repo,
      "cms/config.json",
      { required: false },
    );
    if (!rawConfig) {
      CACHE.set(key, { config: null, expiresAt: Date.now() + TTL_MS });
      return null;
    }

    const config = isRecord(rawConfig) ? rawConfig : {};
    const collectionRefs = Array.isArray(config.collections)
      ? config.collections
      : [];
    const collections: Record<string, unknown> = {};
    const inlineCollections: unknown[] = [];
    const collectionFiles = collectionRefs.filter((entry): entry is string => {
      if (typeof entry === "string") return true;
      inlineCollections.push(entry);
      return false;
    });

    const loadedCollections = await mapWithConcurrency(
      collectionFiles,
      8,
      (entry) => readStateJson(octokit, owner, repo, `cms/${entry}`),
    );

    for (const collection of loadedCollections) {
      if (isRecord(collection) && typeof collection.name === "string") {
        collections[collection.name] = collection;
      }
    }

    for (const entry of inlineCollections) {
      if (isRecord(entry) && typeof entry.name === "string") {
        collections[entry.name] = entry;
      }
    }

    if (!Array.isArray(config.collections) && isRecord(config.collections)) {
      for (const [name, value] of Object.entries(config.collections)) {
        collections[name] = isRecord(value) ? { name, ...value } : value;
      }
    }

    let environment: Record<string, unknown> = {};
    if (typeof config.environmentFile === "string" && config.environmentFile) {
      const rawEnvironment = await readStateJson(
        octokit,
        owner,
        repo,
        `cms/${config.environmentFile}`,
      );
      environment = isRecord(rawEnvironment) ? rawEnvironment : {};
    }

    const normalized = normalizeCmsConfig({
      ...config,
      environment:
        stringOr(environment.name) ?? stringOr(config.environment) ?? "default",
      defaultAdapter:
        stringOr(environment.adapter) ??
        stringOr(config.defaultAdapter) ??
        stringOr(config.adapter),
      writePolicy:
        stringOr(environment.writePolicy) ??
        stringOr(config.writePolicy) ??
        "read-only",
      adapters: {
        ...(isRecord(config.adapters) ? config.adapters : {}),
        ...(typeof environment.adapter === "string"
          ? {
              [environment.adapter]:
                adapterSettingsFromEnvironment(environment),
            }
          : {}),
      },
      collections,
    });

    CACHE.set(key, { config: normalized, expiresAt: Date.now() + TTL_MS });
    return normalized;
  })().finally(() => {
    INFLIGHT.delete(key);
  });

  INFLIGHT.set(key, promise);
  return promise;
}

export function normalizeCmsConfig(rawConfig: unknown): CmsRuntimeConfig {
  const errors: string[] = [];
  const raw = isRecord(rawConfig) ? rawConfig : {};

  if (raw.version !== CMS_CONFIG_VERSION) {
    errors.push(`version must be ${CMS_CONFIG_VERSION}`);
  }

  const defaultAdapter = stringOr(raw.defaultAdapter);
  const writePolicy = normalizeWritePolicy(raw.writePolicy, errors);
  const collections = normalizeCollections(
    raw.collections,
    defaultAdapter,
    writePolicy,
    errors,
  );
  const permissions = normalizePermissions(
    raw.permissions,
    "permissions",
    errors,
  ) ?? {
    content: { ...DEFAULT_CMS_PERMISSIONS.content },
    schema: { ...DEFAULT_CMS_PERMISSIONS.schema },
  };

  if (false && Object.keys(collections).length === 0) {
    errors.push("at least one collection is required");
  }

  if (errors.length > 0) {
    throw new CmsConfigError(errors);
  }

  return {
    version: CMS_CONFIG_VERSION,
    name: stringOr(raw.name) ?? "CMS",
    environment: stringOr(raw.environment) ?? "default",
    defaultAdapter,
    writePolicy,
    permissions,
    adapters: normalizeAdapters(raw.adapters),
    collections,
  };
}

export function normalizeFilters(
  collection: CmsCollectionConfig,
  filters: unknown,
): Record<string, Partial<Record<CmsFilterOperator, unknown>>> {
  const errors: string[] = [];
  const result: Record<
    string,
    Partial<Record<CmsFilterOperator, unknown>>
  > = {};
  const rawFilters = isRecord(filters) ? filters : {};
  const fields = new Map(collection.fields.map((field) => [field.name, field]));
  const allowed = new Map(
    collection.filters.map((filter) => [
      filter.field,
      new Set(filter.operators ?? ["equals"]),
    ]),
  );

  for (const [fieldName, condition] of Object.entries(rawFilters)) {
    const field = fields.get(fieldName);
    if (!field) {
      errors.push(`unknown filter field: ${fieldName}`);
      continue;
    }

    const allowedOperators = allowed.get(fieldName);
    if (!allowedOperators) {
      errors.push(`filter not enabled for field: ${fieldName}`);
      continue;
    }

    const operators = isRecord(condition) ? condition : { equals: condition };
    for (const [operatorName, rawValue] of Object.entries(operators)) {
      if (!FILTER_OPERATORS.has(operatorName as CmsFilterOperator)) {
        errors.push(`unknown filter operator: ${operatorName}`);
        continue;
      }
      const operator = operatorName as CmsFilterOperator;
      if (!allowedOperators.has(operator)) {
        errors.push(`${operator} not enabled for field: ${fieldName}`);
        continue;
      }
      result[fieldName] ??= {};
      result[fieldName][operator] = normalizeFilterValue(operator, rawValue);
    }
  }

  if (errors.length > 0) {
    throw new CmsConfigError(errors);
  }

  return result;
}

export function normalizeSortQuery(
  collection: CmsCollectionConfig,
  sort: CmsSortEntry[] | undefined,
): CmsSortEntry[] | undefined {
  if (!sort) return undefined;

  const errors: string[] = [];
  const fieldNames = new Set(collection.fields.map((field) => field.name));
  const result: CmsSortEntry[] = [];

  for (const entry of sort) {
    if (!fieldNames.has(entry.field)) {
      errors.push(`unknown sort field: ${entry.field}`);
      continue;
    }
    result.push({
      field: entry.field,
      direction: entry.direction === "asc" ? "asc" : "desc",
    });
  }

  if (errors.length > 0) {
    throw new CmsConfigError(errors);
  }

  return result;
}

export function normalizeSearchQuery(
  collection: CmsCollectionConfig,
  search: CmsSearchQuery | undefined,
): CmsSearchQuery | undefined {
  const query = typeof search?.query === "string" ? search.query.trim() : "";
  if (!query) return undefined;

  const errors: string[] = [];
  const fieldsByName = new Map(
    collection.fields.map((field) => [field.name, field]),
  );
  const requestedFields =
    search?.fields && search.fields.length > 0
      ? search.fields
      : collection.searchFields;
  const fields = requestedFields.filter((fieldName) => {
    const field = fieldsByName.get(fieldName);
    if (!field) {
      errors.push(`unknown search field: ${fieldName}`);
      return false;
    }
    if (!isSearchableField(field)) {
      errors.push(`search not enabled for field: ${fieldName}`);
      return false;
    }
    return true;
  });

  if (errors.length > 0) {
    throw new CmsConfigError(errors);
  }

  if (fields.length === 0) {
    throw new CmsConfigError(["no searchable fields configured"]);
  }

  return { query, fields };
}

async function readStateJson(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  options: { required?: boolean } = {},
): Promise<unknown | null> {
  const file = await readStateText(octokit, owner, repo, path);
  if (!file) {
    if (options.required === false) {
      return null;
    }
    throw new CmsConfigError([`missing state file: ${path}`]);
  }
  try {
    return JSON.parse(file.content) as unknown;
  } catch {
    throw new CmsConfigError([`invalid JSON in state file: ${path}`]);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function adapterSettingsFromEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (key === "name" || key === "adapter" || key === "writePolicy") {
      continue;
    }
    if (value !== undefined) settings[key] = value;
  }
  return settings;
}

function normalizeCollections(
  rawCollections: unknown,
  defaultAdapter: string | undefined,
  writePolicy: CmsWritePolicy,
  errors: string[],
): Record<string, CmsCollectionConfig> {
  const result: Record<string, CmsCollectionConfig> = {};
  const entries = isRecord(rawCollections) ? Object.values(rawCollections) : [];

  for (const entry of entries) {
    const collection = normalizeCollection(
      entry,
      defaultAdapter,
      writePolicy,
      errors,
    );
    if (collection) {
      result[collection.name] = collection;
    }
  }

  return result;
}

function normalizeCollection(
  rawCollection: unknown,
  defaultAdapter: string | undefined,
  defaultWritePolicy: CmsWritePolicy,
  errors: string[],
): CmsCollectionConfig | null {
  if (!isRecord(rawCollection)) {
    errors.push("collection must be an object");
    return null;
  }

  const rawName = stringOr(rawCollection.name);
  if (!rawName || !/^[A-Za-z0-9_.-]+$/.test(rawName)) {
    errors.push(
      "collection name must use letters, digits, dashes, underscores, or dots",
    );
    return null;
  }
  const name = normalizeCmsCollectionSlug(rawName);
  const adapter = stringOr(rawCollection.adapter) ?? defaultAdapter;
  if (!adapter) {
    errors.push(`${name}.adapter required when defaultAdapter is not set`);
  }

  const fields = normalizeFields(
    rawCollection.fields,
    `${name}.fields`,
    errors,
  );
  const filters = normalizeCollectionFilters(
    rawCollection.filters,
    fields,
    `${name}.filters`,
    errors,
  );
  const listFields = normalizeListFields(
    rawCollection.listFields,
    fields,
    `${name}.listFields`,
    errors,
  );
  const searchFields = normalizeSearchFields(
    rawCollection.searchFields,
    fields,
    stringOr(rawCollection.titleField),
    `${name}.searchFields`,
    errors,
  );

  return {
    name,
    label: stringOr(rawCollection.label) ?? rawName,
    adapter: adapter ?? "",
    mcpName: stringOr(rawCollection.mcpName),
    titleField: stringOr(rawCollection.titleField),
    searchFields,
    views: normalizeViews(
      rawCollection.views,
      fields,
      listFields,
      `${name}.views`,
      errors,
    ),
    listFields,
    writePolicy: normalizeWritePolicy(
      rawCollection.writePolicy,
      errors,
      defaultWritePolicy,
    ),
    permissions: normalizePermissions(
      rawCollection.permissions,
      `${name}.permissions`,
      errors,
      { fillDefaults: false },
    ),
    source: normalizeSource(
      rawCollection.source,
      rawName !== name ? rawName : undefined,
    ),
    operations: normalizeOperations(rawCollection.operations),
    defaultSort: normalizeCollectionSort(
      rawCollection.defaultSort,
      fields,
      `${name}.defaultSort`,
      errors,
    ),
    fields,
    filters,
  };
}

function normalizeListFields(
  rawListFields: unknown,
  fields: CmsFieldConfig[],
  label: string,
  errors: string[],
): string[] | undefined {
  if (rawListFields == null) return undefined;

  if (!Array.isArray(rawListFields)) {
    errors.push(`${label} must be an array`);
    return undefined;
  }

  const fieldNames = new Set(fields.map((field) => field.name));
  const listFields: string[] = [];

  for (const rawField of rawListFields) {
    const field = stringOr(rawField);
    if (!field) continue;

    if (!fieldNames.has(field)) {
      errors.push(`${label} references unknown field: ${field}`);
      continue;
    }

    if (!listFields.includes(field)) {
      listFields.push(field);
    }
  }

  return listFields.length > 0 ? listFields : undefined;
}

function normalizeSearchFields(
  rawSearchFields: unknown,
  fields: CmsFieldConfig[],
  titleField: string | undefined,
  label: string,
  errors: string[],
): string[] {
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const inferred = inferSearchFields(fields, titleField);

  if (rawSearchFields == null) return inferred;
  if (!Array.isArray(rawSearchFields)) {
    errors.push(`${label} must be an array`);
    return inferred;
  }

  const result: string[] = [];
  for (const entry of rawSearchFields) {
    const name = stringOr(entry);
    const field = name ? fieldsByName.get(name) : undefined;
    if (!name || !field) {
      errors.push(`${label} references unknown field: ${name ?? ""}`);
      continue;
    }
    if (!isSearchableField(field)) {
      errors.push(`${label} references non-searchable field: ${name}`);
      continue;
    }
    if (!result.includes(name)) result.push(name);
  }

  return result;
}

function inferSearchFields(
  fields: CmsFieldConfig[],
  titleField: string | undefined,
): string[] {
  const result: string[] = [];
  const add = (field: CmsFieldConfig | undefined) => {
    if (field && isSearchableField(field) && !result.includes(field.name)) {
      result.push(field.name);
    }
  };

  add(fields.find((field) => field.name === titleField));
  for (const field of fields) add(field);
  return result.slice(0, 4);
}

function normalizeViews(
  rawViews: unknown,
  fields: CmsFieldConfig[],
  legacyListFields: string[] | undefined,
  label: string,
  errors: string[],
): CmsCollectionViewsConfig | undefined {
  const views: CmsCollectionViewsConfig = {};
  const raw = isRecord(rawViews) ? rawViews : {};
  const rawTable = isRecord(raw.table)
    ? raw.table
    : isRecord(raw.list)
      ? raw.list
      : undefined;
  const tableLabel = isRecord(raw.table)
    ? `${label}.table.fields`
    : `${label}.list.fields`;

  const table = normalizeViewFields(
    rawTable?.fields,
    fields,
    tableLabel,
    errors,
  );
  if (table.length > 0) {
    const listView = {
      fields: table,
      pageSize: normalizePageSize(rawTable?.pageSize),
    };
    views.table = listView;
    views.list = listView;
  } else if (legacyListFields?.length) {
    const listView = {
      fields: legacyListFields.map((name, index) => ({
        name,
        role: index === 0 ? ("primary" as const) : ("secondary" as const),
      })),
    };
    views.table = listView;
    views.list = listView;
  }

  const detail = normalizeViewFields(
    isRecord(raw.detail) ? raw.detail.fields : undefined,
    fields,
    `${label}.detail.fields`,
    errors,
  );
  if (detail.length > 0) views.detail = { fields: detail };

  const form = normalizeViewFields(
    isRecord(raw.form) ? raw.form.fields : undefined,
    fields,
    `${label}.form.fields`,
    errors,
  );
  if (form.length > 0) views.form = { fields: form };

  return Object.keys(views).length > 0 ? views : undefined;
}

function normalizeViewFields(
  rawFields: unknown,
  fields: CmsFieldConfig[],
  label: string,
  errors: string[],
): CmsViewFieldConfig[] {
  if (rawFields == null) return [];

  if (!Array.isArray(rawFields)) {
    errors.push(`${label} must be an array`);
    return [];
  }

  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const viewFields: CmsViewFieldConfig[] = [];

  for (const rawField of rawFields) {
    const viewField = normalizeViewField(rawField, fieldsByName, label, errors);
    if (!viewField) continue;
    if (!viewFields.some((field) => field.name === viewField.name)) {
      viewFields.push(viewField);
    }
  }

  return viewFields;
}

function normalizeViewField(
  rawField: unknown,
  fieldsByName: Map<string, CmsFieldConfig>,
  label: string,
  errors: string[],
): CmsViewFieldConfig | null {
  const name =
    typeof rawField === "string"
      ? stringOr(rawField)
      : isRecord(rawField)
        ? stringOr(rawField.name)
        : undefined;

  if (!name) return null;

  const field = fieldsByName.get(name);
  if (!field) {
    errors.push(`${label} references unknown field: ${name}`);
    return null;
  }

  const fieldDisplay = field.display;

  if (!isRecord(rawField)) {
    return {
      name,
      role: fieldDisplay?.role,
      format: fieldDisplay?.format,
      width: fieldDisplay?.width,
    };
  }

  return {
    name,
    label: stringOr(rawField.label),
    role: enumOr(rawField.role, VIEW_FIELD_ROLES) ?? fieldDisplay?.role,
    display: enumOr(rawField.display, VIEW_FIELD_DISPLAYS),
    format: enumOr(rawField.format, VIEW_FIELD_FORMATS) ?? fieldDisplay?.format,
    width: enumOr(rawField.width, VIEW_FIELD_WIDTHS) ?? fieldDisplay?.width,
    sortable:
      typeof rawField.sortable === "boolean" ? rawField.sortable : undefined,
  };
}

function normalizePageSize(value: unknown): number | undefined {
  const pageSize = Number(value);
  if (!Number.isFinite(pageSize)) return undefined;
  return Math.min(100, Math.max(1, Math.floor(pageSize)));
}

function normalizeFields(
  rawFields: unknown,
  label: string,
  errors: string[],
): CmsFieldConfig[] {
  if (!Array.isArray(rawFields)) {
    errors.push(`${label} must be an array`);
    return [];
  }

  const fields: CmsFieldConfig[] = [];
  for (const rawField of rawFields) {
    if (!isRecord(rawField)) {
      errors.push(`${label} entries must be objects`);
      continue;
    }
    const name = stringOr(rawField.name);
    const type = stringOr(rawField.type) ?? "text";
    if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) {
      errors.push(`${label} field name is invalid`);
      continue;
    }
    if (!FIELD_TYPES.has(type as CmsFieldType)) {
      errors.push(`${label}.${name} type is invalid`);
      continue;
    }
    fields.push({
      name,
      type: type as CmsFieldType,
      label: stringOr(rawField.label),
      description: stringOr(rawField.description),
      placeholder: stringOr(rawField.placeholder),
      required: booleanOr(rawField.required),
      readOnly: booleanOr(rawField.readOnly),
      hidden: booleanOr(rawField.hidden),
      display: normalizeFieldDisplay(
        rawField.display,
        `${label}.${name}.display`,
        errors,
      ),
      validation: normalizeFieldValidation(
        rawField.validation,
        `${label}.${name}.validation`,
        errors,
      ),
      options: normalizeOptions(rawField.options),
      target: stringOr(rawField.target),
      valueField: stringOr(rawField.valueField),
      labelField: stringOr(rawField.labelField),
      storage: normalizeFieldStorage(
        rawField.storage,
        `${label}.${name}.storage`,
        errors,
      ),
    });
  }
  return fields;
}

function normalizeFieldDisplay(
  rawDisplay: unknown,
  label: string,
  errors: string[],
): CmsFieldDisplayConfig | undefined {
  if (rawDisplay == null) return undefined;
  if (!isRecord(rawDisplay)) {
    errors.push(`${label} must be an object`);
    return undefined;
  }

  const display: CmsFieldDisplayConfig = {
    description: stringOr(rawDisplay.description),
    placeholder: stringOr(rawDisplay.placeholder),
    role: enumOr(rawDisplay.role, VIEW_FIELD_ROLES),
    format: enumOr(rawDisplay.format, VIEW_FIELD_FORMATS),
    width: enumOr(rawDisplay.width, VIEW_FIELD_WIDTHS),
  };

  if (rawDisplay.role != null && !display.role) {
    errors.push(`${label}.role is invalid`);
  }
  if (rawDisplay.format != null && !display.format) {
    errors.push(`${label}.format is invalid`);
  }
  if (rawDisplay.width != null && !display.width) {
    errors.push(`${label}.width is invalid`);
  }

  return pruneUndefined(display);
}

function normalizeFieldValidation(
  rawValidation: unknown,
  label: string,
  errors: string[],
): CmsFieldValidationConfig | undefined {
  if (rawValidation == null) return undefined;
  if (!isRecord(rawValidation)) {
    errors.push(`${label} must be an object`);
    return undefined;
  }

  const validation: CmsFieldValidationConfig = {};
  const min = finiteNumberOr(rawValidation.min);
  const max = finiteNumberOr(rawValidation.max);
  const minLength = integerOr(rawValidation.minLength);
  const maxLength = integerOr(rawValidation.maxLength);
  const pattern = stringOr(rawValidation.pattern);

  if (rawValidation.min != null) {
    if (min == null) errors.push(`${label}.min must be a number`);
    else validation.min = min;
  }
  if (rawValidation.max != null) {
    if (max == null) errors.push(`${label}.max must be a number`);
    else validation.max = max;
  }
  if (min != null && max != null && min > max) {
    errors.push(`${label}.min must be less than or equal to max`);
  }

  if (rawValidation.minLength != null) {
    if (minLength == null || minLength < 0) {
      errors.push(`${label}.minLength must be a non-negative integer`);
    } else {
      validation.minLength = minLength;
    }
  }
  if (rawValidation.maxLength != null) {
    if (maxLength == null || maxLength < 0) {
      errors.push(`${label}.maxLength must be a non-negative integer`);
    } else {
      validation.maxLength = maxLength;
    }
  }
  if (
    minLength != null &&
    maxLength != null &&
    minLength >= 0 &&
    maxLength >= 0 &&
    minLength > maxLength
  ) {
    errors.push(`${label}.minLength must be less than or equal to maxLength`);
  }

  if (pattern) {
    try {
      new RegExp(pattern);
      validation.pattern = pattern;
    } catch {
      errors.push(`${label}.pattern is invalid`);
    }
  } else if (rawValidation.pattern != null) {
    errors.push(`${label}.pattern must be a non-empty string`);
  }

  return Object.keys(validation).length > 0 ? validation : undefined;
}

function normalizeFieldStorage(
  rawStorage: unknown,
  label: string,
  errors: string[],
): CmsFieldConfig["storage"] {
  if (rawStorage == null) return undefined;
  if (!isRecord(rawStorage)) {
    errors.push(`${label} must be an object`);
    return undefined;
  }

  const kind = stringOr(rawStorage.kind);
  if (!kind || !FIELD_STORAGE_KINDS.has(kind as CmsFieldStorageKind)) {
    errors.push(`${label}.kind is invalid`);
    return undefined;
  }

  return { kind: kind as CmsFieldStorageKind };
}

function normalizeCollectionFilters(
  rawFilters: unknown,
  fields: CmsFieldConfig[],
  label: string,
  errors: string[],
): CmsFilterConfig[] {
  if (rawFilters === undefined) return [];
  if (!Array.isArray(rawFilters)) {
    errors.push(`${label} must be an array`);
    return [];
  }

  const fieldNames = new Set(fields.map((field) => field.name));
  const filters: CmsFilterConfig[] = [];
  for (const rawFilter of rawFilters) {
    if (!isRecord(rawFilter)) {
      errors.push(`${label} entries must be objects`);
      continue;
    }
    const field = stringOr(rawFilter.field);
    if (!field || !fieldNames.has(field)) {
      errors.push(`${label} references unknown field: ${field ?? ""}`);
      continue;
    }
    const operators = Array.isArray(rawFilter.operators)
      ? rawFilter.operators.filter((op): op is CmsFilterOperator =>
          FILTER_OPERATORS.has(op as CmsFilterOperator),
        )
      : ["equals" as CmsFilterOperator];
    filters.push({ field, operators });
  }
  return filters;
}

function normalizeOperations(rawOperations: unknown): CmsCollectionOperations {
  const raw = isRecord(rawOperations) ? rawOperations : {};
  return {
    list: booleanOr(raw.list, DEFAULT_READ_ONLY_OPERATIONS.list),
    get: booleanOr(raw.get, DEFAULT_READ_ONLY_OPERATIONS.get),
    search: booleanOr(raw.search, DEFAULT_READ_ONLY_OPERATIONS.search),
    create: booleanOr(raw.create, DEFAULT_READ_ONLY_OPERATIONS.create),
    update: booleanOr(raw.update, DEFAULT_READ_ONLY_OPERATIONS.update),
    delete: booleanOr(raw.delete, DEFAULT_READ_ONLY_OPERATIONS.delete),
  };
}

function normalizeSort(rawSort: unknown): CmsSortEntry[] {
  if (!Array.isArray(rawSort)) return [];
  return rawSort.flatMap((entry): CmsSortEntry[] => {
    if (typeof entry === "string") {
      const field = entry.replace(/^-/, "");
      if (!field) return [];
      return [{ field, direction: entry.startsWith("-") ? "desc" : "asc" }];
    }
    if (!isRecord(entry)) return [];
    const field = stringOr(entry.field);
    if (!field) return [];
    const direction = entry.direction === "asc" ? "asc" : "desc";
    return [{ field, direction }];
  });
}

function normalizeCollectionSort(
  rawSort: unknown,
  fields: CmsFieldConfig[],
  label: string,
  errors: string[],
): CmsSortEntry[] {
  const sort = normalizeSort(rawSort);
  const fieldNames = new Set(fields.map((field) => field.name));
  return sort.filter((entry) => {
    if (fieldNames.has(entry.field)) return true;
    errors.push(`${label} references unknown field: ${entry.field}`);
    return false;
  });
}

function normalizeSource(
  rawSource: unknown,
  fallbackCollection?: string,
): CmsCollectionConfig["source"] {
  if (!isRecord(rawSource)) {
    return fallbackCollection ? { collection: fallbackCollection } : {};
  }
  return {
    collection: stringOr(rawSource.collection) ?? fallbackCollection,
    idField: stringOr(rawSource.idField),
    path: stringOr(rawSource.path),
    extension: stringOr(rawSource.extension),
  };
}

function normalizeAdapters(rawAdapters: unknown): CmsRuntimeConfig["adapters"] {
  if (!isRecord(rawAdapters)) return {};
  const adapters: CmsRuntimeConfig["adapters"] = {};
  for (const [name, value] of Object.entries(rawAdapters)) {
    if (isRecord(value)) {
      adapters[name] = { ...value };
    }
  }
  return adapters;
}

function normalizeOptions(rawOptions: unknown): CmsFieldConfig["options"] {
  if (!Array.isArray(rawOptions)) return undefined;
  const options: NonNullable<CmsFieldConfig["options"]> = [];
  for (const option of rawOptions) {
    if (typeof option === "string") {
      options.push(option);
      continue;
    }
    if (!isRecord(option)) continue;
    const value = stringOr(option.value);
    if (!value) continue;
    options.push({ value, label: stringOr(option.label) ?? value });
  }
  return options;
}

function normalizeWritePolicy(
  rawValue: unknown,
  errors: string[],
  fallback: CmsWritePolicy = "read-only",
): CmsWritePolicy {
  if (typeof rawValue !== "string") return fallback;
  if (!WRITE_POLICIES.has(rawValue as CmsWritePolicy)) {
    errors.push(`invalid writePolicy: ${rawValue}`);
    return fallback;
  }
  return rawValue as CmsWritePolicy;
}

function normalizePermissions(
  rawPermissions: unknown,
  label: string,
  errors: string[],
  options: { fillDefaults?: boolean } = { fillDefaults: true },
): CmsPermissionsConfig | undefined {
  const fillDefaults = options.fillDefaults !== false;
  if (!isRecord(rawPermissions)) {
    return fillDefaults
      ? {
          content: { ...DEFAULT_CMS_PERMISSIONS.content },
          schema: { ...DEFAULT_CMS_PERMISSIONS.schema },
        }
      : undefined;
  }

  const content = normalizeRoleMap(
    rawPermissions.content,
    CONTENT_OPERATIONS,
    DEFAULT_CMS_PERMISSIONS.content,
    `${label}.content`,
    errors,
    { fillDefaults },
  );
  const schema = normalizeRoleMap(
    rawPermissions.schema,
    SCHEMA_OPERATIONS,
    DEFAULT_CMS_PERMISSIONS.schema,
    `${label}.schema`,
    errors,
    { fillDefaults },
  );

  const permissions: CmsPermissionsConfig = {};
  if (content && Object.keys(content).length > 0) permissions.content = content;
  if (schema && Object.keys(schema).length > 0) permissions.schema = schema;
  return permissions;
}

function normalizeRoleMap<T extends string>(
  rawMap: unknown,
  operations: readonly T[],
  defaults: Record<T, CmsRole[]>,
  label: string,
  errors: string[],
  options: { fillDefaults: boolean },
): Partial<Record<T, CmsRole[]>> | undefined {
  if (!isRecord(rawMap)) {
    return options.fillDefaults ? { ...defaults } : undefined;
  }

  const result: Partial<Record<T, CmsRole[]>> = {};
  for (const operation of operations) {
    if (operation in rawMap || options.fillDefaults) {
      result[operation] = normalizeRoles(
        rawMap[operation],
        defaults[operation],
        {
          label: `${label}.${operation}`,
          errors,
        },
      );
    }
  }
  return result;
}

function normalizeRoles(
  rawRoles: unknown,
  fallback: CmsRole[],
  options: { label: string; errors: string[] },
): CmsRole[] {
  if (!Array.isArray(rawRoles)) return [...fallback];
  const roles: CmsRole[] = [];
  for (const role of rawRoles) {
    if (!CMS_ROLES.has(role as CmsRole)) {
      options.errors.push(`${options.label} has invalid role: ${String(role)}`);
      continue;
    }
    if (!roles.includes(role as CmsRole)) roles.push(role as CmsRole);
  }
  if (!roles.includes("admin")) roles.push("admin");
  return roles;
}

function normalizeFilterValue(
  operator: CmsFilterOperator,
  value: unknown,
): unknown {
  if (operator === "in") {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [];
  }

  if (operator === "exists") {
    if (typeof value === "boolean") return value;
    return value === "true" || value === "1" || value === 1;
  }

  return value;
}

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function enumOr<T extends string>(
  value: unknown,
  allowed: Set<T>,
): T | undefined {
  return typeof value === "string" && allowed.has(value as T)
    ? (value as T)
    : undefined;
}

function booleanOr(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finiteNumberOr(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function integerOr(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

function pruneUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function toCmsCollectionSlugOrNull(value: string): string | null {
  const slug = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .replace(/^_+/, "");
  if (!slug) return null;
  if (CMS_COLLECTION_SLUG_RE.test(slug)) return slug;

  const prefixed = `collection-${slug}`;
  return CMS_COLLECTION_SLUG_RE.test(prefixed) ? prefixed : null;
}

function isSearchableField(field: CmsFieldConfig): boolean {
  return !field.hidden && SEARCHABLE_FIELD_TYPES.has(field.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
