import "server-only";

import type { Octokit } from "@octokit/rest";

import { CmsConfigError, normalizeCmsConfig } from "@dashboard/lib/cms/config";
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
    rawCollections[collection.name] = collection;
    return null;
  }

  const inlineCollections = Array.isArray(rawCollections)
    ? rawCollections.filter(
        (entry) =>
          isRecord(entry) && String(entry.name ?? "") !== collection.name,
      )
    : [];
  const collectionRefs = Array.isArray(rawCollections)
    ? rawCollections.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  for (const ref of collectionRefs) {
    const path = `cms/${ref}`;
    const file = await readStateText(octokit, owner, repo, path);
    if (!file) continue;
    const existing = parseJsonRecord(file.content, path);
    if (existing.name === collection.name) return path;
  }

  const ref = `collections/${collection.name}.json`;
  root.collections = [
    ...collectionRefs.filter((entry) => entry !== ref),
    ...inlineCollections,
    ref,
  ];
  return `cms/${ref}`;
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
