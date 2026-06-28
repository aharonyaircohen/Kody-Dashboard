import {
  assertCmsFieldValue,
  isBlankCmsValue,
} from "@dashboard/lib/cms/validation";
import type { CmsDocument, CmsFieldConfig } from "@dashboard/lib/cms/types";

export type CmsFormValue = string | boolean | string[];
export type CmsFormValues = Record<string, CmsFormValue>;

export interface CmsResolvedFormField {
  field: CmsFieldConfig;
}

export function buildCmsFormValues(
  fields: CmsResolvedFormField[],
  document?: CmsDocument,
): CmsFormValues {
  const values: CmsFormValues = {};

  for (const { field } of fields) {
    const value = document?.[field.name];

    if (field.type === "boolean") {
      values[field.name] = Boolean(value);
      continue;
    }

    if (field.type === "date") {
      values[field.name] = toDateTimeLocalValue(value);
      continue;
    }

    if (field.type === "multiSelect") {
      values[field.name] = toCmsStringArray(value);
      continue;
    }

    if (field.type === "relationMany") {
      values[field.name] = Array.isArray(value)
        ? value
            .map((item) => cmsRelationId(item, field))
            .filter((item): item is string => Boolean(item))
        : [];
      continue;
    }

    if (field.type === "relation") {
      values[field.name] = cmsRelationId(value, field) ?? "";
      continue;
    }

    if (["json", "object", "array"].includes(field.type)) {
      values[field.name] =
        value === undefined ? "" : JSON.stringify(value, null, 2);
      continue;
    }

    if (Array.isArray(value)) {
      values[field.name] = value
        .map((item) => formatShortCmsValue(item))
        .join(", ");
      continue;
    }

    values[field.name] = value == null ? "" : String(value);
  }

  return values;
}

export function buildCmsFormPayload(
  fields: CmsResolvedFormField[],
  values: CmsFormValues,
  options: {
    clearBlankValues?: boolean;
    originalDocument?: CmsDocument;
  } = {},
): CmsDocument {
  const payload: CmsDocument = {};

  for (const { field } of fields) {
    const hasValue = Object.prototype.hasOwnProperty.call(values, field.name);
    const value = values[field.name];

    if (isBlankCmsFormValue(value)) {
      if (field.required)
        throw new Error(`${field.label ?? field.name} is required.`);
      if (
        options.clearBlankValues &&
        hasValue &&
        hadNonBlankOriginalValue(field, options.originalDocument)
      ) {
        payload[field.name] = blankCmsFieldValue(field);
      }
      continue;
    }

    const parsed = parseCmsFormValue(field, value);
    assertCmsFieldValue(field, parsed);
    payload[field.name] = parsed;
  }

  return payload;
}

export function splitCmsListValue(value: CmsFormValue): string[] {
  return Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

export function toCmsStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "string") return splitCmsListValue(value);
  if (value === null || value === undefined || value === false) return [];
  return [String(value)];
}

function parseCmsFormValue(
  field: CmsFieldConfig,
  value: CmsFormValue,
): unknown {
  if (field.type === "boolean") return Boolean(value);
  if (field.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field.label ?? field.name} must be a number.`);
    }
    return parsed;
  }
  if (field.type === "date") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${field.label ?? field.name} must be a date.`);
    }
    return date.toISOString();
  }
  if (["json", "object", "array"].includes(field.type)) {
    try {
      return JSON.parse(String(value));
    } catch {
      throw new Error(`${field.label ?? field.name} must be valid JSON.`);
    }
  }
  if (field.type === "multiSelect") {
    return Array.isArray(value) ? value : splitCmsListValue(value);
  }
  if (field.type === "relationMany") {
    return splitCmsListValue(value);
  }
  return String(value);
}

function blankCmsFieldValue(field: CmsFieldConfig): unknown {
  if (
    field.type === "array" ||
    field.type === "multiSelect" ||
    field.type === "relationMany"
  ) {
    return [];
  }
  return null;
}

function hadNonBlankOriginalValue(
  field: CmsFieldConfig,
  document: CmsDocument | undefined,
): boolean {
  if (!document) return false;
  if (!Object.prototype.hasOwnProperty.call(document, field.name)) return false;
  return !isBlankCmsValue(document[field.name]);
}

function isBlankCmsFormValue(value: CmsFormValue | undefined): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === "";
}

function toDateTimeLocalValue(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function formatShortCmsValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return "JSON";
  return String(value);
}

function cmsRelationId(value: unknown, field: CmsFieldConfig): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const configuredValue =
      field.valueField &&
      record[field.valueField] !== null &&
      record[field.valueField] !== undefined &&
      record[field.valueField] !== ""
        ? record[field.valueField]
        : undefined;
    const id = configuredValue ?? record.id ?? record._id;
    return id === null || id === undefined || id === "" ? null : String(id);
  }

  return String(value);
}
