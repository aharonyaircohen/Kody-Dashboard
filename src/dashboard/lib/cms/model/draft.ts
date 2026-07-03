import type {
  CmsCollectionConfig,
  CmsFieldConfig,
  CmsFieldOption,
  CmsFieldType,
  CmsFilterConfig,
  CmsSortEntry,
  CmsViewFieldConfig,
} from "../types";

export type CmsModelFieldType = Exclude<CmsFieldType, "id">;

export interface CmsModelFieldDraft {
  key: string;
  name: string;
  label: string;
  type: CmsModelFieldType;
  required: boolean;
  readOnly: boolean;
  hidden: boolean;
  description: string;
  placeholder: string;
  optionsText: string;
  target: string;
  valueField: string;
  labelField: string;
}

export interface CmsModelResourceDraft {
  name: string;
  label: string;
  sourceCollection: string;
  titleField: string;
  fields: CmsModelFieldDraft[];
}

export interface CmsModelValidationIssue {
  message: string;
  fieldKey?: string;
}

export const CMS_MODEL_FIELD_TYPES: Array<{
  value: CmsModelFieldType;
  label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "True/false" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
  { value: "multiSelect", label: "Multi-select" },
  { value: "relation", label: "Reference" },
  { value: "relationMany", label: "References" },
  { value: "json", label: "JSON" },
  { value: "object", label: "Object" },
  { value: "array", label: "Array" },
];

const CMS_FIELD_TYPES = new Set<CmsFieldType>([
  "id",
  ...CMS_MODEL_FIELD_TYPES.map((type) => type.value),
]);

export function isCmsFieldType(value: unknown): value is CmsFieldType {
  return (
    typeof value === "string" && CMS_FIELD_TYPES.has(value as CmsFieldType)
  );
}

export function isCmsModelFieldType(
  value: unknown,
): value is CmsModelFieldType {
  return (
    typeof value === "string" &&
    value !== "id" &&
    CMS_FIELD_TYPES.has(value as CmsFieldType)
  );
}

export function newCmsModelResourceDraft(): CmsModelResourceDraft {
  return {
    name: "",
    label: "",
    sourceCollection: "",
    titleField: "title",
    fields: [
      newCmsModelFieldDraft(0, {
        name: "title",
        label: "Title",
        required: true,
      }),
    ],
  };
}

export function newCmsModelFieldDraft(
  index: number,
  patch: Partial<CmsModelFieldDraft> = {},
): CmsModelFieldDraft {
  return {
    key: `field-${Date.now()}-${index}`,
    name: `field${index + 1}`,
    label: `Field ${index + 1}`,
    type: "text",
    required: false,
    readOnly: false,
    hidden: false,
    description: "",
    placeholder: "",
    optionsText: "",
    target: "",
    valueField: "",
    labelField: "",
    ...patch,
  };
}

export function cmsModelResourceDraftFromCollection(
  collection: CmsCollectionConfig,
): CmsModelResourceDraft {
  return {
    name: collection.name,
    label: collection.label,
    sourceCollection: collection.source.collection ?? collection.name,
    titleField: collection.titleField ?? "",
    fields: collection.fields
      .filter((field) => field.name !== "_id")
      .map((field, index) => cmsModelFieldDraftFromConfig(field, index)),
  };
}

export function cmsModelFieldDraftFromConfig(
  field: CmsFieldConfig,
  index: number,
): CmsModelFieldDraft {
  return {
    key: `${field.name}-${index}`,
    name: field.name,
    label: field.label ?? titleizeCmsModelName(field.name),
    type: cmsModelFieldTypeFromConfig(field.type),
    required: Boolean(field.required),
    readOnly: Boolean(field.readOnly),
    hidden: Boolean(field.hidden),
    description: field.description ?? field.display?.description ?? "",
    placeholder: field.placeholder ?? field.display?.placeholder ?? "",
    optionsText: (field.options ?? [])
      .map((option) => (typeof option === "string" ? option : option.value))
      .join(", "),
    target: field.target ?? "",
    valueField: field.valueField ?? "",
    labelField: field.labelField ?? "",
  };
}

export function cmsCollectionFromModelDraft(
  draft: CmsModelResourceDraft,
): CmsCollectionConfig {
  const name = draft.name.trim() || "resource";
  const fields = draft.fields
    .filter((field) => field.name.trim().length > 0)
    .map(cmsFieldConfigFromModelDraft);
  const titleField = pickCmsModelTitleField(fields, draft.titleField);
  const searchFields = inferCmsModelSearchFields(fields, titleField);
  const tableFields = inferCmsModelListFields(fields, titleField, searchFields);

  return {
    name,
    label: draft.label.trim() || titleizeCmsModelName(name),
    adapter: "storage",
    titleField,
    searchFields,
    writePolicy: "enabled",
    source: {
      collection: draft.sourceCollection.trim() || name,
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
      table: { fields: tableFields },
      list: { fields: tableFields },
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
}

export function cmsFieldConfigFromModelDraft(
  field: CmsModelFieldDraft,
): CmsFieldConfig {
  const config: CmsFieldConfig = {
    name: field.name.trim(),
    label: field.label.trim() || titleizeCmsModelName(field.name),
    type: field.type,
    required: field.required || undefined,
    readOnly: field.readOnly || undefined,
    hidden: field.hidden || undefined,
    description: field.description.trim() || undefined,
    placeholder: field.placeholder.trim() || undefined,
    storage: cmsModelStorageForField(field.type),
  };
  if (field.type === "select" || field.type === "multiSelect") {
    const options = cmsModelOptionsFromText(field.optionsText);
    if (options.length > 0) config.options = options;
  }
  if (field.type === "relation" || field.type === "relationMany") {
    const target = field.target.trim();
    const valueField = field.valueField.trim();
    const labelField = field.labelField.trim();
    if (target) config.target = target;
    if (valueField) config.valueField = valueField;
    if (labelField) config.labelField = labelField;
  }
  return config;
}

export function validateCmsModelDraft({
  draft,
  collections,
  originalName,
}: {
  draft: CmsModelResourceDraft;
  collections: CmsCollectionConfig[];
  originalName?: string | null;
}): CmsModelValidationIssue[] {
  const issues: CmsModelValidationIssue[] = [];
  const resourceName = draft.name.trim();
  const collectionNames = new Set(
    collections.map((collection) => collection.name),
  );
  if (resourceName) collectionNames.add(resourceName);

  if (!resourceName) {
    issues.push({ message: "Resource name is required." });
  } else if (!isCleanCmsModelName(resourceName)) {
    issues.push({ message: "Resource name has invalid characters." });
  }

  const nameChanged = Boolean(
    originalName && resourceName && resourceName !== originalName,
  );
  if (
    resourceName &&
    resourceName !== originalName &&
    collections.some((collection) => collection.name === resourceName)
  ) {
    issues.push({ message: `Resource "${resourceName}" already exists.` });
  }
  if (nameChanged) {
    issues.push({ message: "Renaming resources is not supported yet." });
  }

  if (draft.fields.length === 0) {
    issues.push({ message: "Add at least one field." });
  }

  const fieldNames = new Map<string, string>();
  for (const field of draft.fields) {
    const fieldName = field.name.trim();
    if (!fieldName) {
      issues.push({ fieldKey: field.key, message: "Field name is required." });
    } else if (!isCleanCmsModelName(fieldName)) {
      issues.push({
        fieldKey: field.key,
        message: `${fieldName} has invalid characters.`,
      });
    } else if (fieldNames.has(fieldName)) {
      issues.push({
        fieldKey: field.key,
        message: `Duplicate field: ${fieldName}.`,
      });
    } else {
      fieldNames.set(fieldName, field.key);
    }

    if (isRelationCmsModelField(field)) {
      const target = field.target.trim();
      if (!target) {
        issues.push({
          fieldKey: field.key,
          message: `${field.label || field.name} needs a target resource.`,
        });
      } else if (!collectionNames.has(target)) {
        issues.push({
          fieldKey: field.key,
          message: `${field.label || field.name} targets unknown resource: ${target}.`,
        });
      }
    }
  }

  return issues;
}

export function cmsModelFieldTypeFromConfig(
  type: CmsFieldType,
): CmsModelFieldType {
  return isCmsModelFieldType(type) ? type : "text";
}

export function inferCmsModelFilters(
  fields: CmsFieldConfig[],
): CmsFilterConfig[] {
  const filters: CmsFilterConfig[] = [];
  for (const field of fields) {
    if (field.hidden || field.type === "id") continue;
    if (field.type === "text" || field.type === "textarea") {
      filters.push({ field: field.name, operators: ["contains", "equals"] });
      continue;
    }
    if (field.type === "select" || field.type === "relation") {
      filters.push({ field: field.name, operators: ["equals", "in"] });
      continue;
    }
    if (field.type === "multiSelect" || field.type === "relationMany") {
      filters.push({ field: field.name, operators: ["in"] });
      continue;
    }
    if (field.type === "boolean") {
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

export function inferCmsModelListFields(
  fields: CmsFieldConfig[],
  titleField: string | undefined,
  searchFields: string[],
): CmsViewFieldConfig[] {
  const result: CmsViewFieldConfig[] = [];
  const add = (name: string | undefined, role?: CmsViewFieldConfig["role"]) => {
    if (!name || result.some((entry) => entry.name === name)) return;
    const field = fields.find((candidate) => candidate.name === name);
    if (!field || field.hidden || field.type === "json") return;
    result.push({ name, ...(role ? { role } : {}) });
  };

  add(titleField, "primary");
  for (const field of fields) {
    if (result.length >= 5) break;
    if (field.name === titleField || field.name === "_id") continue;
    if (searchFields.includes(field.name)) add(field.name, "secondary");
  }
  for (const field of fields) {
    if (result.length >= 6) break;
    if (field.name === titleField || field.name === "_id") continue;
    add(field.name);
  }
  return result;
}

export function inferCmsModelSearchFields(
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
  for (const field of fields) add(field.name);
  return result.slice(0, 6);
}

export function inferCmsModelDefaultSort(
  fields: CmsFieldConfig[],
): CmsSortEntry[] {
  if (fields.some((field) => field.name === "updatedAt")) {
    return [{ field: "updatedAt", direction: "desc" }];
  }
  if (fields.some((field) => field.name === "createdAt")) {
    return [{ field: "createdAt", direction: "desc" }];
  }
  return [];
}

export function pickCmsModelTitleField(
  fields: CmsFieldConfig[],
  requested: string | undefined,
): string | undefined {
  if (requested && fields.some((field) => field.name === requested)) {
    return requested;
  }
  return (
    ["title", "name", "label", "email"].find((name) =>
      fields.some((field) => field.name === name),
    ) ?? fields.find((field) => field.type === "text")?.name
  );
}

export function cmsModelOptionsFromText(text: string): CmsFieldOption[] {
  return text
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({ value, label: titleizeCmsModelName(value) }));
}

export function cmsModelStorageForField(
  type: CmsFieldType,
): CmsFieldConfig["storage"] {
  if (type === "id" || type === "relation") return { kind: "objectId" };
  if (type === "relationMany") return { kind: "objectIdArray" };
  if (type === "number") return { kind: "number" };
  if (type === "boolean") return { kind: "boolean" };
  if (type === "date") return { kind: "date" };
  if (type === "multiSelect") return { kind: "stringArray" };
  if (type === "json") return { kind: "json" };
  if (type === "object") return { kind: "object" };
  if (type === "array") return { kind: "array" };
  return undefined;
}

export function cleanCmsModelName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "");
}

export function isCleanCmsModelName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

export function titleizeCmsModelName(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isRelationCmsModelField(field: CmsModelFieldDraft): boolean {
  return field.type === "relation" || field.type === "relationMany";
}
