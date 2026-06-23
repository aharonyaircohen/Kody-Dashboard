#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MongoClient, ObjectId } from "mongodb";

const DEFAULT_INTERNAL_COLLECTIONS = new Set([
  "A",
  "payload-jobs",
  "payload-kvs",
  "payload-locked-documents",
  "payload-mcp-api-keys",
  "payload-migrations",
  "payload-preferences",
]);

const SYSTEM_FIELDS = new Set(["_id", "__v", "createdAt", "updatedAt"]);
const SENSITIVE_RE = /(password|secret|token|hash|salt|session|ipHash|userAgentHash)/i;
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

const COMMON_RELATIONS = new Map([
  ["actor", "users"],
  ["author", "users"],
  ["createdby", "users"],
  ["updatedby", "users"],
  ["owner", "users"],
  ["student", "users"],
  ["teacher", "users"],
  ["user", "users"],
  ["users", "users"],
  ["tenant", "tenants"],
  ["tenants", "tenants"],
  ["category", "categories"],
  ["categories", "categories"],
  ["course", "courses"],
  ["courses", "courses"],
  ["chapter", "chapters"],
  ["chapters", "chapters"],
  ["lesson", "lessons"],
  ["lessons", "lessons"],
  ["sourcelesson", "lessons"],
  ["outputlesson", "lessons"],
  ["translatedfrom", "__self__"],
  ["exercise", "exercises"],
  ["exercises", "exercises"],
  ["media", "media"],
  ["mediafile", "media"],
  ["mediafiles", "media"],
  ["contentfile", "media"],
  ["intromedia", "media"],
  ["file", "media"],
  ["files", "media"],
  ["asset", "media"],
  ["assets", "media"],
  ["prompt", "prompts"],
  ["prompts", "prompts"],
  ["teacherprofile", "teacher_profiles"],
  ["product", "products"],
  ["products", "products"],
  ["coupon", "coupons"],
  ["coupons", "coupons"],
  ["form", "forms"],
  ["forms", "forms"],
  ["formulasheet", "formula-sheets"],
  ["formulasheets", "formula-sheets"],
  ["transaction", "transactions"],
  ["transactions", "transactions"],
  ["subscription", "subscriptions"],
  ["subscriptions", "subscriptions"],
]);

const args = parseArgs(process.argv.slice(2));

if (args.help || !args["state-root"] || !args.repo || !args["env-file"]) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const stateRoot = path.resolve(String(args["state-root"]));
const repoName = String(args.repo);
const cmsRoot = path.join(stateRoot, repoName, "cms");
const collectionsRoot = path.join(cmsRoot, "collections");
const envFile = path.resolve(String(args["env-file"]));
const databaseUriEnv = String(args["database-uri-env"] ?? "DATABASE_URL");
const databaseName = optionalString(args["database-name"]);
const sampleSize = Number(args["sample-size"] ?? 100);
const environment = String(args.environment ?? "dev");
const cmsName = String(args.name ?? `${repoName} CMS`);
const skipCollections = new Set([
  ...DEFAULT_INTERNAL_COLLECTIONS,
  ...csv(args.skip),
]);

const env = readEnvFile(envFile);
const uri = env[databaseUriEnv] ?? process.env[databaseUriEnv];
if (!uri) {
  throw new Error(`Missing ${databaseUriEnv} in ${envFile}`);
}

fs.mkdirSync(collectionsRoot, { recursive: true });
fs.mkdirSync(path.join(cmsRoot, "environments"), { recursive: true });

const existingCollections = readExistingCollections(collectionsRoot);
const client = new MongoClient(uri);

try {
  await client.connect();
  const db = databaseName ? client.db(databaseName) : client.db();
  const collectionNames = (await db.listCollections().toArray())
    .map((collection) => collection.name)
    .filter((name) => !shouldSkipCollection(name, skipCollections))
    .sort((a, b) => a.localeCompare(b));

  const rawStats = new Map();
  for (const collectionName of collectionNames) {
    const docs = await db.collection(collectionName).find({}).limit(sampleSize).toArray();
    rawStats.set(collectionName, analyzeCollection(collectionName, docs));
  }

  const titleFields = new Map();
  for (const collectionName of collectionNames) {
    titleFields.set(collectionName, inferTitleField(rawStats.get(collectionName)));
  }

  const generatedFiles = [];
  for (const collectionName of collectionNames) {
    const generated = buildCollectionConfig({
      collectionName,
      collectionNames,
      existing: existingCollections.get(collectionName),
      stats: rawStats.get(collectionName),
      titleFields,
    });
    const file = path.join(collectionsRoot, `${collectionName}.json`);
    writeJson(file, generated);
    generatedFiles.push(`collections/${collectionName}.json`);
  }

  removeStaleGeneratedCollections(collectionsRoot, generatedFiles);

  writeJson(path.join(cmsRoot, "environments", `${environment}.json`), {
    name: environment,
    adapter: "mongodb",
    databaseUriSecret: databaseUriEnv,
    ...(databaseName ? { databaseName } : {}),
    writePolicy: "enabled",
  });

  writeJson(path.join(cmsRoot, "config.json"), {
    version: 1,
    name: cmsName,
    environment,
    environmentFile: `environments/${environment}.json`,
    defaultAdapter: "mongodb",
    writePolicy: "enabled",
    collections: generatedFiles,
  });

  console.log(
    JSON.stringify(
      {
        repo: repoName,
        environment,
        collections: generatedFiles.length,
        stateRoot,
        cmsRoot,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

function buildCollectionConfig({
  collectionName,
  collectionNames,
  existing,
  stats,
  titleFields,
}) {
  const titleField = existingFieldStillExists(existing?.titleField, stats)
    ? existing.titleField
    : titleFields.get(collectionName);
  const fields = stats.fields.map((fieldStats) =>
    mergeExistingField(
      buildFieldConfig(fieldStats, collectionName, collectionNames, titleFields),
      existing,
    ),
  );
  const fieldByName = new Map(fields.map((field) => [field.name, field]));
  const searchFields = inferSearchFields(fields, titleField);
  const listFields = inferListFields(fields, titleField, searchFields);
  const filters = inferFilters(listFields.map((entry) => fieldByName.get(entry.name)).filter(Boolean));

  return {
    name: collectionName,
    label: titleize(collectionName),
    adapter: "mongodb",
    mcpName: existing?.mcpName ?? toMcpName(collectionName),
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
      list: {
        fields: listFields,
      },
      detail: {
        fields: fields.filter((field) => !field.hidden).map((field) => ({ name: field.name })),
      },
      form: {
        fields: fields
          .filter((field) => !field.hidden && !field.readOnly && field.type !== "id")
          .map((field) => ({ name: field.name })),
      },
    },
    filters,
  };
}

function buildFieldConfig(fieldStats, collectionName, collectionNames, titleFields) {
  const name = fieldStats.name;
  const base = {
    name,
    type: inferFieldType(fieldStats, name),
    label: labelForField(name),
  };

  if (name === "_id") return { ...base, type: "id", label: "ID", readOnly: true };
  if (name === "__v") return { ...base, type: "number", label: "Version", readOnly: true, hidden: true };
  if (name === "createdAt" || name === "updatedAt") return { ...base, type: "date", readOnly: true };
  if (SENSITIVE_RE.test(name)) base.hidden = true;

  const relationTarget = inferRelationTarget(name, base.type, collectionName, collectionNames);
  if (relationTarget) {
    const targetTitleField = titleFields.get(relationTarget);
    return {
      ...base,
      type: base.type === "relationMany" ? "relationMany" : "relation",
      target: relationTarget,
      valueField: "_id",
      labelField: relationLabelField(relationTarget, targetTitleField),
    };
  }

  if (base.type === "relation") {
    base.type = "text";
  }
  if (base.type === "relationMany") {
    base.type = "array";
  }

  if (base.type === "select" || base.type === "multiSelect") {
    const options = inferOptions(fieldStats);
    if (options.length > 0) base.options = options;
  }

  return base;
}

function mergeExistingField(generated, existingCollection) {
  const existing = existingCollection?.fields?.find((field) => field.name === generated.name);
  if (!existing) return generated;
  return {
    ...generated,
    ...(existing.required !== undefined ? { required: existing.required } : {}),
    ...(existing.readOnly !== undefined ? { readOnly: existing.readOnly } : {}),
    ...(existing.hidden !== undefined ? { hidden: existing.hidden } : {}),
    ...mergeOptionConfig(generated.options, existing.options),
    ...(existing.target ? { target: existing.target } : {}),
    ...(existing.valueField ? { valueField: existing.valueField } : {}),
    ...(existing.labelField ? { labelField: existing.labelField } : {}),
    ...(existing.label && generated.label === labelForField(generated.name)
      ? { label: existing.label }
      : {}),
  };
}

function inferFieldType(fieldStats, fieldName) {
  if (fieldName === "_id") return "id";
  if (fieldStats.types.has("array")) {
    if (arrayLooksLikeObjectIds(fieldStats)) return "relationMany";
    if (arrayLooksLikeEnum(fieldStats)) return "multiSelect";
    return "array";
  }
  if (fieldStats.types.has("objectId")) return "relation";
  if (fieldStats.types.has("date") || looksLikeDateField(fieldName)) return "date";
  if (fieldStats.types.has("boolean")) return "boolean";
  if (fieldStats.types.has("number")) return "number";
  if (fieldStats.types.has("object")) return "object";
  if (stringLooksLikeEnum(fieldStats, fieldName)) return "select";
  if (stringLooksLikeTextarea(fieldStats, fieldName)) return "textarea";
  return "text";
}

function inferTitleField(stats) {
  const fieldNames = new Set(stats.fields.map((field) => field.name));
  for (const candidate of TITLE_FIELD_CANDIDATES) {
    if (fieldNames.has(candidate)) return candidate;
  }
  const labelField = stats.fields.find((field) => /label$/i.test(field.name));
  if (labelField) return labelField.name;
  const textField = stats.fields.find((field) => field.types.has("string"));
  return textField?.name ?? "_id";
}

function inferSearchFields(fields, titleField) {
  const result = [];
  const add = (name) => {
    if (!name || result.includes(name)) return;
    const field = fields.find((candidate) => candidate.name === name);
    if (!field || field.hidden) return;
    if (!["text", "textarea", "select"].includes(field.type)) return;
    result.push(name);
  };

  add(titleField);
  for (const field of fields) {
    if (TEXT_SEARCH_RE.test(field.name) || /label/i.test(field.name)) add(field.name);
  }
  return result.slice(0, 8);
}

function inferListFields(fields, titleField, searchFields) {
  const result = [];
  const add = (name, view = {}) => {
    if (!name || result.some((entry) => entry.name === name)) return;
    const field = fields.find((candidate) => candidate.name === name);
    if (!field || field.hidden || !isCompactListField(field)) return;
    result.push({ name, ...view });
  };

  add(titleField, { role: "primary", width: "fill" });

  for (const name of searchFields) {
    if (name !== titleField && /label$/i.test(name)) add(name);
  }
  for (const name of searchFields) {
    if (name !== titleField && /(status|type|kind|access|visibility|state|locale)$/i.test(name)) {
      add(name);
    }
  }
  for (const name of ["tenant", "course", "chapter", "lesson", "user"]) add(name);
  for (const name of ["updatedAt", "createdAt"]) add(name);

  for (const name of searchFields) {
    if (result.length >= 6) break;
    if (name !== titleField && /adminTitle|slug|code|key|email|name/i.test(name)) add(name);
  }

  for (const field of fields) {
    if (result.length >= 6) break;
    if (!SYSTEM_FIELDS.has(field.name)) add(field.name);
  }

  return result.slice(0, 6);
}

function inferFilters(fields) {
  return fields.flatMap((field) => {
    if (field.hidden || field.type === "id") return [];
    if (field.type === "text" || field.type === "textarea") {
      return [{ field: field.name, operators: ["contains", "equals"] }];
    }
    if (field.type === "select") {
      return [{ field: field.name, operators: ["equals", "in"] }];
    }
    if (field.type === "multiSelect" || field.type === "relationMany") {
      return [{ field: field.name, operators: ["in"] }];
    }
    if (field.type === "relation") {
      return [{ field: field.name, operators: ["equals"] }];
    }
    if (field.type === "boolean") {
      return [{ field: field.name, operators: ["equals"] }];
    }
    if (field.type === "number" || field.type === "date") {
      return [{ field: field.name, operators: ["equals", "greater_than_equal", "less_than_equal"] }];
    }
    return [];
  });
}

function inferDefaultSort(fieldByName) {
  if (fieldByName.get("order")?.type === "number") {
    return [{ field: "order", direction: "asc" }];
  }
  if (fieldByName.has("updatedAt")) return [{ field: "updatedAt", direction: "desc" }];
  if (fieldByName.has("createdAt")) return [{ field: "createdAt", direction: "desc" }];
  return [];
}

function inferRelationTarget(fieldName, fieldType, collectionName, collectionNames) {
  if (fieldType !== "relation" && fieldType !== "relationMany") return null;
  const normalized = normalizeRelationName(fieldName);
  const commonTarget = COMMON_RELATIONS.get(normalized);
  if (commonTarget === "__self__") return collectionName;
  if (commonTarget && collectionNames.includes(commonTarget)) return commonTarget;

  const variants = [
    normalized,
    `${normalized}s`,
    `${normalized}es`,
    normalized.replace(/y$/, "ies"),
  ];
  for (const collection of collectionNames) {
    const normalizedCollection = normalizeRelationName(collection);
    if (variants.includes(normalizedCollection)) return collection;
  }
  return null;
}

function relationLabelField(targetCollection, titleField) {
  if (targetCollection === "users") return "email";
  return titleField ?? "_id";
}

function analyzeCollection(collectionName, docs) {
  const fields = new Map();
  const ensure = (name) => {
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
    return fields.get(name);
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

function recordValue(field, value) {
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
  if (type === "string") {
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
  if (type === "object") {
    field.types.add("object");
  }
}

function compareFields(a, b) {
  const priority = ["_id", "title", "name", "label", "chapterLabel", "courseLabel", "status", "order"];
  const aIndex = priority.indexOf(a.name);
  const bIndex = priority.indexOf(b.name);
  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  }
  if (SYSTEM_FIELDS.has(a.name) && !SYSTEM_FIELDS.has(b.name)) return 1;
  if (!SYSTEM_FIELDS.has(a.name) && SYSTEM_FIELDS.has(b.name)) return -1;
  return a.name.localeCompare(b.name);
}

function arrayLooksLikeObjectIds(fieldStats) {
  const samples = fieldStats.arrayValues.filter((value) => value !== null && value !== undefined);
  if (samples.length === 0) return false;
  return samples.some((value) => value instanceof ObjectId || isObjectIdString(value));
}

function arrayLooksLikeEnum(fieldStats) {
  const samples = fieldStats.arrayValues.filter((value) => typeof value === "string");
  return samples.length > 0 && new Set(samples).size <= 20;
}

function stringLooksLikeEnum(fieldStats, fieldName) {
  if (!fieldStats.types.has("string")) return false;
  if (!/(status|type|kind|role|locale|currency|provider|access|visibility|state)$/i.test(fieldName)) {
    return false;
  }
  return fieldStats.stringValues.size > 0 && fieldStats.stringValues.size <= 20;
}

function stringLooksLikeTextarea(fieldStats, fieldName) {
  if (!fieldStats.types.has("string")) return false;
  return (
    fieldStats.maxStringLength > 160 ||
    /(description|content|body|notes|message|prompt|summary|meta)$/i.test(fieldName)
  );
}

function inferOptions(fieldStats) {
  return [...fieldStats.stringValues]
    .filter((value) => value !== "")
    .sort((a, b) => String(a).localeCompare(String(b)))
    .slice(0, 50);
}

function mergeOptionConfig(generatedOptions, existingOptions) {
  if (!generatedOptions && !existingOptions) return {};
  const result = [];
  const seen = new Set();
  for (const option of [...(existingOptions ?? []), ...(generatedOptions ?? [])]) {
    const value = typeof option === "string" ? option : option?.value;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(option);
  }
  return result.length > 0 ? { options: result } : {};
}

function looksLikeDateField(fieldName) {
  return /(At|Date|Until|Expires|From|To)$/i.test(fieldName);
}

function isCompactListField(field) {
  return !["array", "json", "object", "textarea", "relationMany", "multiSelect"].includes(field.type);
}

function existingFieldStillExists(fieldName, stats) {
  if (!fieldName) return false;
  return stats.fields.some((field) => field.name === fieldName);
}

function normalizeRelationName(name) {
  return String(name)
    .replace(/(?:Id|Ids)$/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

function isObjectIdString(value) {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
}

function shouldSkipCollection(name, skipCollections) {
  return (
    skipCollections.has(name) ||
    /^_.*_versions$/.test(name) ||
    name.endsWith("_versions")
  );
}

function readExistingCollections(root) {
  const collections = new Map();
  if (!fs.existsSync(root)) return collections;
  for (const entry of fs.readdirSync(root)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(root, entry), "utf8"));
      if (parsed?.name) collections.set(parsed.name, parsed);
    } catch {
      // Invalid existing files should not prevent regeneration.
    }
  }
  return collections;
}

function removeStaleGeneratedCollections(root, generatedFiles) {
  const keep = new Set(generatedFiles.map((file) => path.basename(file)));
  for (const entry of fs.readdirSync(root)) {
    if (entry.endsWith(".json") && !keep.has(entry)) {
      fs.rmSync(path.join(root, entry));
    }
  }
}

function readEnvFile(file) {
  const result = {};
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "help") {
      result.help = true;
      continue;
    }
    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

function csv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function optionalString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function titleize(value) {
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelForField(value) {
  if (value === "_id") return "ID";
  if (value === "__v") return "Version";
  return titleize(value);
}

function toMcpName(collectionName) {
  return String(collectionName).replace(/[^A-Za-z0-9_]/g, "_");
}

function printUsage() {
  console.log(`Usage:
  pnpm cms:generate-mongodb -- --state-root /path/to/kody-state --repo A-Guy-Web --env-file /path/to/.env

Options:
  --database-uri-env NAME    Env var holding the MongoDB URI. Default: DATABASE_URL
  --database-name NAME       Optional database override. By default the URI database is used.
  --environment NAME         CMS environment file name. Default: dev
  --name NAME                CMS display name. Default: "<repo> CMS"
  --sample-size N            Documents sampled per collection. Default: 100
  --skip a,b,c               Additional Mongo collections to skip.
`);
}
