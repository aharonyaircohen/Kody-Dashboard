import type {
  CmsCollectionConfig,
  CmsDocument,
  CmsFieldConfig,
  CmsFieldOption,
} from "./types";

export function getCmsDocumentValidationIssues(
  collection: CmsCollectionConfig,
  document: CmsDocument,
  options: { partial?: boolean } = {},
): string[] {
  const issues: string[] = [];
  const fieldsByName = new Map(
    collection.fields.map((field) => [field.name, field]),
  );

  for (const field of collection.fields) {
    const hasValue = Object.prototype.hasOwnProperty.call(document, field.name);
    if (options.partial && !hasValue) continue;

    const value = document[field.name];
    const issue = getCmsFieldValidationIssue(field, value, {
      requireRequired: !options.partial && field.required,
      strictType: true,
    });
    if (issue) issues.push(issue);
  }

  for (const fieldName of Object.keys(document)) {
    if (!fieldsByName.has(fieldName)) {
      issues.push(`unknown field: ${fieldName}.`);
    }
  }

  return issues;
}

export function getCmsFieldValidationIssue(
  field: CmsFieldConfig,
  value: unknown,
  options: { requireRequired?: boolean; strictType?: boolean } = {},
): string | null {
  const label = field.label ?? field.name;
  const required = Boolean(options.requireRequired || field.required);

  if (isBlankCmsValue(value)) {
    return required ? `${label} is required.` : null;
  }

  if (field.type === "number") {
    if (options.strictType && typeof value !== "number") {
      return `${label} must be a number.`;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) return `${label} must be a number.`;
    if (field.validation?.min != null && number < field.validation.min) {
      return `${label} must be at least ${field.validation.min}.`;
    }
    if (field.validation?.max != null && number > field.validation.max) {
      return `${label} must be at most ${field.validation.max}.`;
    }
    return null;
  }

  if (field.type === "date") {
    if (
      options.strictType &&
      !(typeof value === "string" || value instanceof Date)
    ) {
      return `${label} must be a date.`;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? `${label} must be a date.` : null;
  }

  if (field.type === "boolean") {
    return options.strictType && typeof value !== "boolean"
      ? `${label} must be a boolean.`
      : null;
  }

  if (field.type === "select") {
    if (options.strictType && typeof value !== "string") {
      return `${label} must be a string.`;
    }
    return validateOptions(field, [String(value)]);
  }

  if (field.type === "multiSelect") {
    if (options.strictType && !isStringArray(value)) {
      return `${label} must be an array of strings.`;
    }
    return validateOptions(field, toStringArray(value));
  }

  if (field.type === "relationMany") {
    return options.strictType && !isStringArray(value)
      ? `${label} must be an array of ids.`
      : null;
  }

  if (field.type === "array") {
    return options.strictType && !Array.isArray(value)
      ? `${label} must be an array.`
      : null;
  }

  if (field.type === "object") {
    return options.strictType && !isPlainObject(value)
      ? `${label} must be an object.`
      : null;
  }

  if (field.type === "json") {
    return options.strictType && !isJsonContainer(value)
      ? `${label} must be JSON.`
      : null;
  }

  if (isTextField(field)) {
    if (options.strictType && typeof value !== "string") {
      return `${label} must be a string.`;
    }
    const text = String(value);
    if (
      field.validation?.minLength != null &&
      text.length < field.validation.minLength
    ) {
      return `${label} must be at least ${field.validation.minLength} characters.`;
    }
    if (
      field.validation?.maxLength != null &&
      text.length > field.validation.maxLength
    ) {
      return `${label} must be at most ${field.validation.maxLength} characters.`;
    }
    if (field.validation?.pattern) {
      const pattern = new RegExp(field.validation.pattern);
      if (!pattern.test(text)) return `${label} is invalid.`;
    }
  }

  return null;
}

export function assertCmsFieldValue(
  field: CmsFieldConfig,
  value: unknown,
  options: { requireRequired?: boolean } = {},
): void {
  const issue = getCmsFieldValidationIssue(field, value, options);
  if (issue) throw new Error(issue);
}

export function isBlankCmsValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validateOptions(
  field: CmsFieldConfig,
  values: string[],
): string | null {
  const options = field.options?.map(optionValue).filter(Boolean) ?? [];
  if (options.length === 0) return null;
  const invalid = values.find((value) => !options.includes(value));
  if (!invalid) return null;
  const label = field.label ?? field.name;
  return `${label} must be one of: ${options.join(", ")}.`;
}

function optionValue(option: string | CmsFieldOption): string {
  return typeof option === "string" ? option : option.value;
}

function isTextField(field: CmsFieldConfig): boolean {
  return (
    field.type === "text" ||
    field.type === "textarea" ||
    field.type === "id" ||
    field.type === "relation"
  );
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value == null ? [] : [String(value)];
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isJsonContainer(value: unknown): boolean {
  return isPlainObject(value) || Array.isArray(value);
}
