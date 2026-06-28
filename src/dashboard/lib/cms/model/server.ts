import "server-only";

import type { Octokit } from "@octokit/rest";

import {
  CmsConfigError,
  normalizeCmsCollectionSlug,
  normalizeCmsConfig,
} from "@dashboard/lib/cms/config";
import { CmsRuntimeError } from "@dashboard/lib/cms/service";
import type {
  CmsCollectionConfig,
  CmsFieldConfig,
} from "@dashboard/lib/cms/types";
import { readStateText } from "@dashboard/lib/state-repo";

import {
  cmsModelOptionsFromText,
  cmsModelStorageForField,
  inferCmsModelDefaultSort,
  inferCmsModelFilters,
  inferCmsModelListFields,
  inferCmsModelSearchFields,
  isCmsFieldType,
  pickCmsModelTitleField,
  titleizeCmsModelName,
} from "./draft";

const CMS_DATABASE_URL_SECRET = "DATABASE_URL";
const CMS_MODEL_COLLECTION_SORT_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export interface SanitizeCmsModelPayloadOptions {
  existingCollections: CmsCollectionConfig[];
  originalName?: string | null;
}

export function sanitizeCmsModelCollectionPayload(
  input: unknown,
  options: SanitizeCmsModelPayloadOptions,
): CmsCollectionConfig {
  if (!isRecord(input)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "request body must be an object",
      400,
    );
  }
  const rawCollection = input.collection;
  if (!isRecord(rawCollection)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "collection must be an object",
      400,
    );
  }

  const name = cleanSlug(rawCollection.name, "collection name");
  validateResourceSaveTarget(name, options);

  const fields = sanitizeFields(rawCollection.fields, {
    resourceName: name,
    existingCollections: options.existingCollections,
  });
  const source = isRecord(rawCollection.source) ? rawCollection.source : {};
  const sourceCollection =
    stringValue(source.collection) ??
    stringValue(rawCollection.sourceCollection) ??
    name;
  const titleField = pickCmsModelTitleField(
    fields,
    stringValue(rawCollection.titleField),
  );
  const searchFields = inferCmsModelSearchFields(fields, titleField);
  const listFields = inferCmsModelListFields(fields, titleField, searchFields);

  const collection: CmsCollectionConfig = {
    name,
    label: stringValue(rawCollection.label) ?? titleizeCmsModelName(name),
    adapter: "mongodb",
    titleField,
    searchFields,
    writePolicy: "enabled",
    source: {
      collection: sourceCollection,
      idField: "_id",
    },
    operations: {
      list: true,
      get: true,
      search: true,
      create: true,
      update: true,
      delete: true,
    },
    defaultSort: inferCmsModelDefaultSort(fields),
    fields,
    views: {
      table: { fields: listFields },
      list: { fields: listFields },
      detail: {
        fields: fields
          .filter((field) => !field.hidden)
          .map((field) => ({ name: field.name })),
      },
      form: {
        fields: fields
          .filter((field) => !field.hidden && !field.readOnly)
          .map((field) => ({ name: field.name })),
      },
    },
    filters: inferCmsModelFilters(fields),
  };

  normalizeCmsConfig({
    version: 1,
    name: "CMS",
    environment: "default",
    defaultAdapter: "mongodb",
    writePolicy: "enabled",
    collections: { [collection.name]: collection },
  });

  return collection;
}

export async function buildCmsModelFiles({
  octokit,
  owner,
  repo,
  collection,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  collection: CmsCollectionConfig;
}) {
  const configFile = await readStateText(
    octokit,
    owner,
    repo,
    "cms/config.json",
  );
  const files: Array<{ path: string; content: string }> = [];
  const root = configFile
    ? parseJsonRecord(configFile.content, "cms/config.json")
    : {
        version: 1,
        name: `${repo} CMS`,
        environment: "default",
        environmentFile: "environments/default.json",
        defaultAdapter: "mongodb",
        writePolicy: "enabled",
        collections: [],
      };

  root.version = 1;
  root.name = stringValue(root.name) ?? `${repo} CMS`;
  root.environment = stringValue(root.environment) ?? "default";
  root.environmentFile =
    stringValue(root.environmentFile) ?? "environments/default.json";
  root.defaultAdapter = stringValue(root.defaultAdapter) ?? "mongodb";
  root.writePolicy = stringValue(root.writePolicy) ?? "enabled";

  const collectionPath = await upsertCollectionRef(
    octokit,
    owner,
    repo,
    root,
    collection,
  );
  if (collectionPath) {
    files.push({
      path: collectionPath,
      content: `${JSON.stringify(collection, null, 2)}\n`,
    });
  }

  files.push({
    path: "cms/config.json",
    content: `${JSON.stringify(root, null, 2)}\n`,
  });

  if (
    !(await readStateText(
      octokit,
      owner,
      repo,
      "cms/environments/default.json",
    ))
  ) {
    files.push({
      path: "cms/environments/default.json",
      content: `${JSON.stringify(
        {
          name: "default",
          adapter: "mongodb",
          databaseUriSecret: CMS_DATABASE_URL_SECRET,
          writePolicy: "enabled",
        },
        null,
        2,
      )}\n`,
    });
  }

  return files;
}

export async function buildDeleteCmsModelFiles({
  octokit,
  owner,
  repo,
  name,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  name: unknown;
}): Promise<{
  files: Array<{ path: string; content: string }>;
  deleteFile: { path: string; sha: string } | null;
  name: string;
}> {
  const resourceName = cleanSlug(name, "resource name");
  const configFile = await readStateText(
    octokit,
    owner,
    repo,
    "cms/config.json",
  );
  if (!configFile) {
    throw new CmsConfigError(["missing state file: cms/config.json"], {
      code: "cms_not_configured",
      status: 404,
    });
  }

  const root = parseJsonRecord(configFile.content, "cms/config.json");
  const deletePlan = await removeCollectionRef(
    octokit,
    owner,
    repo,
    root,
    resourceName,
  );
  appendSchemaGenerationSkipCollections(root, deletePlan.skipCollections);

  return {
    files: [
      {
        path: "cms/config.json",
        content: `${JSON.stringify(root, null, 2)}\n`,
      },
    ],
    deleteFile: deletePlan.deleteFile,
    name: resourceName,
  };
}

export function assertCmsModelResourceDeletable(
  name: string,
  collections: CmsCollectionConfig[],
): void {
  const references = collections
    .filter((collection) => collection.name !== name)
    .filter((collection) =>
      collection.fields.some(
        (field) =>
          (field.type === "relation" || field.type === "relationMany") &&
          field.target === name,
      ),
    )
    .map((collection) => collection.name);

  if (references.length > 0) {
    throw new CmsRuntimeError(
      "invalid_body",
      `resource is referenced by: ${references.join(", ")}`,
      409,
    );
  }
}

function sanitizeFields(
  input: unknown,
  options: {
    resourceName: string;
    existingCollections: CmsCollectionConfig[];
  },
): CmsFieldConfig[] {
  if (!Array.isArray(input)) {
    throw new CmsRuntimeError("invalid_body", "fields must be an array", 400);
  }

  const fields: CmsFieldConfig[] = [];
  const names = new Set<string>();
  const addField = (field: CmsFieldConfig) => {
    if (names.has(field.name)) {
      throw new CmsRuntimeError(
        "invalid_body",
        `duplicate field: ${field.name}`,
        400,
      );
    }
    names.add(field.name);
    fields.push(field);
  };

  addField({
    name: "_id",
    label: "ID",
    type: "id",
    readOnly: true,
    storage: { kind: "objectId" },
  });

  for (const rawField of input) {
    if (!isRecord(rawField)) continue;
    const name = cleanSlug(rawField.name, "field name");
    if (name === "_id") continue;
    const type =
      isCmsFieldType(rawField.type) && rawField.type !== "id"
        ? rawField.type
        : "text";
    const field: CmsFieldConfig = {
      name,
      type,
      label: stringValue(rawField.label) ?? titleizeCmsModelName(name),
      description: stringValue(rawField.description),
      placeholder: stringValue(rawField.placeholder),
      required: booleanValue(rawField.required),
      readOnly: booleanValue(rawField.readOnly),
      hidden: booleanValue(rawField.hidden),
      storage: cmsModelStorageForField(type),
    };
    const optionsList = sanitizeOptions(rawField.options);
    if (
      optionsList.length > 0 &&
      (field.type === "select" || field.type === "multiSelect")
    ) {
      field.options = optionsList;
    }
    if (field.type === "relation" || field.type === "relationMany") {
      applyRelationConfig(field, rawField, options);
    }
    addField(field);
  }

  if (!names.has("title")) {
    addField({
      name: "title",
      type: "text",
      label: "Title",
      required: true,
    });
  }

  return fields;
}

async function upsertCollectionRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  root: Record<string, unknown>,
  collection: CmsCollectionConfig,
): Promise<string | null> {
  const rawCollections = root.collections;
  if (isRecord(rawCollections)) {
    const entries = Object.entries(rawCollections);
    const existing = entries.find(([key, value]) =>
      collectionRecordEntryMatches(key, value, collection.name),
    );
    const nextCollections = { ...rawCollections };
    if (existing) {
      delete nextCollections[existing[0]];
      nextCollections[existing[0]] = collection;
    } else {
      nextCollections[collection.name] = collection;
    }
    root.collections = sortCmsCollectionRecord(nextCollections);
    return null;
  }

  const entries = Array.isArray(rawCollections) ? rawCollections : [];
  const inlineCollections: unknown[] = [];
  let replacedInline = false;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const key = stringValue(entry.name) ?? collection.name;
    if (collectionRecordEntryMatches(key, entry, collection.name)) {
      if (!replacedInline) inlineCollections.push(collection);
      replacedInline = true;
      continue;
    }
    inlineCollections.push(entry);
  }

  if (replacedInline) {
    root.collections = sortCmsCollectionEntries([
      ...entries.filter((entry): entry is string => typeof entry === "string"),
      ...inlineCollections,
    ]);
    return null;
  }

  const collectionRefs = Array.isArray(rawCollections)
    ? rawCollections.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  for (const ref of collectionRefs) {
    const path = `cms/${ref}`;
    if (collectionNameMatches(cmsCollectionNameFromKey(ref), collection.name)) {
      return path;
    }
    const file = await readStateText(octokit, owner, repo, path);
    if (!file) continue;
    const existing = parseJsonRecord(file.content, path);
    if (collectionRecordEntryMatches(ref, existing, collection.name)) {
      return path;
    }
  }

  const ref = `collections/${collection.name}.json`;
  root.collections = sortCmsCollectionEntries([
    ...collectionRefs.filter((entry) => entry !== ref),
    ...inlineCollections,
    ref,
  ]);
  return `cms/${ref}`;
}

async function removeCollectionRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  root: Record<string, unknown>,
  name: string,
): Promise<{
  deleteFile: { path: string; sha: string } | null;
  skipCollections: string[];
}> {
  const rawCollections = root.collections;
  if (isRecord(rawCollections)) {
    const removedEntries = Object.entries(rawCollections).filter(
      ([key, value]) => collectionRecordEntryMatches(key, value, name),
    );
    const next = Object.fromEntries(
      Object.entries(rawCollections).filter(
        ([key, value]) => !collectionRecordEntryMatches(key, value, name),
      ),
    );
    if (Object.keys(next).length === Object.keys(rawCollections).length) {
      throw new CmsRuntimeError(
        "not_found",
        `resource not found: ${name}`,
        404,
      );
    }
    root.collections = sortCmsCollectionRecord(next);
    return {
      deleteFile: null,
      skipCollections: removedEntries.flatMap(([key, value]) =>
        collectionSkipNames(value, key, name),
      ),
    };
  }

  const entries = Array.isArray(rawCollections) ? rawCollections : [];
  const removedInlineEntries = entries.filter((entry) =>
    collectionRecordEntryMatches(name, entry, name),
  );
  const inlineCollections = entries.filter(
    (entry) =>
      isRecord(entry) && !collectionRecordEntryMatches(name, entry, name),
  );
  const removedInline =
    inlineCollections.length !== entries.filter(isRecord).length;
  const collectionRefs = entries.filter(
    (entry): entry is string => typeof entry === "string",
  );
  const keptRefs: string[] = [];
  let deleteFile: { path: string; sha: string } | null = null;
  let removedRef = false;
  const skipCollections = removedInlineEntries.flatMap((entry) =>
    collectionSkipNames(entry, name, name),
  );

  for (const ref of collectionRefs) {
    const path = `cms/${ref}`;
    const file = await readStateText(octokit, owner, repo, path);
    let existing: Record<string, unknown> | null = null;
    let matches = collectionNameMatches(cmsCollectionNameFromKey(ref), name);
    if (!matches && file) {
      existing = parseJsonRecord(file.content, path);
      matches = collectionRecordEntryMatches(ref, existing, name);
    } else if (file) {
      existing = parseJsonRecord(file.content, path);
    }

    if (matches) {
      removedRef = true;
      if (file?.sha) deleteFile = { path, sha: file.sha };
      skipCollections.push(...collectionSkipNames(existing, ref, name));
      continue;
    }

    keptRefs.push(ref);
  }

  if (!removedInline && !removedRef) {
    throw new CmsRuntimeError("not_found", `resource not found: ${name}`, 404);
  }

  root.collections = sortCmsCollectionEntries([
    ...keptRefs,
    ...inlineCollections,
  ]);
  return { deleteFile, skipCollections };
}

function collectionRecordEntryMatches(
  key: string,
  value: unknown,
  name: string,
): boolean {
  if (collectionNameMatches(cmsCollectionNameFromKey(key) ?? key, name)) {
    return true;
  }
  if (isRecord(value)) {
    const source = isRecord(value.source) ? value.source : {};
    return [
      stringValue(value.name),
      stringValue(source.collection),
      stringValue(value.mcpName),
    ].some((candidate) => collectionNameMatches(candidate, name));
  }
  if (typeof value === "string") {
    return (
      collectionNameMatches(cmsCollectionNameFromKey(value), name) ||
      collectionNameMatches(value, name)
    );
  }
  return false;
}

function collectionSkipNames(
  value: unknown,
  key: string,
  fallbackName: string,
): string[] {
  const names = new Set<string>();
  const fallback = cmsCollectionNameFromKey(key) ?? fallbackName;
  if (fallback) names.add(fallback);
  if (fallbackName) names.add(fallbackName);
  if (isRecord(value)) {
    const source = isRecord(value.source) ? value.source : {};
    const sourceCollection = stringValue(source.collection);
    const name = stringValue(value.name);
    if (sourceCollection) names.add(sourceCollection);
    if (name) names.add(name);
  }
  return [...names].filter(Boolean);
}

function cmsCollectionNameFromKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^collections\//, "").replace(/\.json$/i, "");
}

function collectionNameMatches(
  candidate: string | null | undefined,
  name: string,
): boolean {
  if (!candidate) return false;
  return candidate === name || normalizeCmsCollectionSlug(candidate) === name;
}

function appendSchemaGenerationSkipCollections(
  root: Record<string, unknown>,
  collections: string[],
): void {
  const next = new Set<string>(readSchemaGenerationSkipCollections(root));
  for (const collection of collections) {
    const trimmed = collection.trim();
    if (trimmed) next.add(trimmed);
  }
  if (next.size === 0) return;
  root.schemaGeneration = {
    ...(isRecord(root.schemaGeneration) ? root.schemaGeneration : {}),
    skipCollections: [...next].sort((left, right) =>
      CMS_MODEL_COLLECTION_SORT_COLLATOR.compare(left, right),
    ),
  };
}

function readSchemaGenerationSkipCollections(
  root: Record<string, unknown>,
): string[] {
  if (!isRecord(root.schemaGeneration)) return [];
  const raw = root.schemaGeneration.skipCollections;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const value = stringValue(entry);
    return value ? [value] : [];
  });
}

export function sortCmsCollectionEntries(entries: unknown[]): unknown[] {
  return [...entries].sort((left, right) =>
    CMS_MODEL_COLLECTION_SORT_COLLATOR.compare(
      cmsCollectionEntrySortKey(left),
      cmsCollectionEntrySortKey(right),
    ),
  );
}

function sortCmsCollectionRecord(
  collections: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(collections).sort(([left], [right]) =>
      CMS_MODEL_COLLECTION_SORT_COLLATOR.compare(left, right),
    ),
  );
}

function cmsCollectionEntrySortKey(entry: unknown): string {
  if (typeof entry === "string") {
    return entry
      .replace(/^collections\//, "")
      .replace(/\.json$/i, "")
      .trim();
  }
  if (isRecord(entry)) {
    return stringValue(entry.label) ?? stringValue(entry.name) ?? "";
  }
  return "";
}

function applyRelationConfig(
  field: CmsFieldConfig,
  rawField: Record<string, unknown>,
  options: {
    resourceName: string;
    existingCollections: CmsCollectionConfig[];
  },
) {
  const target = stringValue(rawField.target);
  if (!target) {
    throw new CmsRuntimeError(
      "invalid_body",
      `${field.name} relation target is required`,
      400,
    );
  }
  const targetNames = new Set([
    options.resourceName,
    ...options.existingCollections.map((collection) => collection.name),
  ]);
  if (!targetNames.has(target)) {
    throw new CmsRuntimeError(
      "invalid_body",
      `${field.name} references unknown resource: ${target}`,
      400,
    );
  }
  field.target = target;
  field.valueField = stringValue(rawField.valueField);
  field.labelField = stringValue(rawField.labelField);
}

function validateResourceSaveTarget(
  name: string,
  options: SanitizeCmsModelPayloadOptions,
) {
  if (options.originalName && options.originalName !== name) {
    throw new CmsRuntimeError(
      "invalid_body",
      "renaming resources is not supported yet",
      400,
    );
  }
  if (
    options.originalName === null &&
    options.existingCollections.some((collection) => collection.name === name)
  ) {
    throw new CmsRuntimeError(
      "invalid_body",
      `resource already exists: ${name}`,
      400,
    );
  }
}

function sanitizeOptions(
  input: unknown,
): NonNullable<CmsFieldConfig["options"]> {
  if (!Array.isArray(input)) return [];
  return input.flatMap((option) => {
    if (typeof option === "string") {
      return cmsModelOptionsFromText(option);
    }
    if (!isRecord(option)) return [];
    const value = stringValue(option.value);
    if (!value) return [];
    return [
      {
        value,
        label: stringValue(option.label) ?? titleizeCmsModelName(value),
      },
    ];
  });
}

function parseJsonRecord(
  content: string,
  path: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // handled below
  }
  throw new CmsConfigError([`invalid JSON in state file: ${path}`]);
}

function cleanSlug(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text || !/^[A-Za-z0-9_.-]+$/.test(text)) {
    throw new CmsRuntimeError(
      "invalid_body",
      `${label} must use letters, digits, dashes, underscores, or dots`,
      400,
    );
  }
  return text;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
