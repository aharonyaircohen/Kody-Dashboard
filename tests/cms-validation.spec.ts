import { describe, expect, it } from "vitest";

import {
  getCmsDocumentValidationIssues,
  getCmsFieldValidationIssue,
  isBlankCmsValue,
} from "@dashboard/lib/cms/validation";
import type {
  CmsCollectionConfig,
  CmsFieldConfig,
} from "@dashboard/lib/cms/types";

describe("CMS field validation", () => {
  it("treats optional blank values as valid and required blank values as invalid", () => {
    const field: CmsFieldConfig = { name: "title", type: "text" };

    expect(isBlankCmsValue("  ")).toBe(true);
    expect(getCmsFieldValidationIssue(field, "")).toBeNull();
    expect(getCmsFieldValidationIssue({ ...field, required: true }, "")).toBe(
      "title is required.",
    );
  });

  it("validates numeric bounds", () => {
    const field: CmsFieldConfig = {
      name: "score",
      type: "number",
      label: "Score",
      validation: { min: 0, max: 100 },
    };

    expect(getCmsFieldValidationIssue(field, "not-a-number")).toBe(
      "Score must be a number.",
    );
    expect(getCmsFieldValidationIssue(field, -1)).toBe(
      "Score must be at least 0.",
    );
    expect(getCmsFieldValidationIssue(field, 101)).toBe(
      "Score must be at most 100.",
    );
    expect(getCmsFieldValidationIssue(field, 50)).toBeNull();
  });

  it("validates text length and pattern", () => {
    const field: CmsFieldConfig = {
      name: "code",
      type: "text",
      label: "Code",
      validation: { minLength: 2, maxLength: 4, pattern: "^[A-Z]+$" },
    };

    expect(getCmsFieldValidationIssue(field, "A")).toBe(
      "Code must be at least 2 characters.",
    );
    expect(getCmsFieldValidationIssue(field, "ABCDE")).toBe(
      "Code must be at most 4 characters.",
    );
    expect(getCmsFieldValidationIssue(field, "ab")).toBe("Code is invalid.");
    expect(getCmsFieldValidationIssue(field, "AB")).toBeNull();
  });

  it("validates select and multi-select options", () => {
    const status: CmsFieldConfig = {
      name: "status",
      type: "select",
      label: "Status",
      options: ["draft", { label: "Published", value: "published" }],
    };
    const tags: CmsFieldConfig = {
      name: "tags",
      type: "multiSelect",
      label: "Tags",
      options: ["math", "science"],
    };

    expect(getCmsFieldValidationIssue(status, "archived")).toBe(
      "Status must be one of: draft, published.",
    );
    expect(getCmsFieldValidationIssue(status, "published")).toBeNull();
    expect(getCmsFieldValidationIssue(tags, ["math", "history"])).toBe(
      "Tags must be one of: math, science.",
    );
    expect(getCmsFieldValidationIssue(tags, "math, science")).toBeNull();
  });

  it("validates dates", () => {
    const field: CmsFieldConfig = {
      name: "publishedAt",
      type: "date",
      label: "Published at",
    };

    expect(getCmsFieldValidationIssue(field, "nope")).toBe(
      "Published at must be a date.",
    );
    expect(
      getCmsFieldValidationIssue(field, "2026-01-02T03:04:05Z"),
    ).toBeNull();
  });

  it("validates a CMS document against the collection schema", () => {
    const collection = testCollection();

    expect(
      getCmsDocumentValidationIssues(collection, {
        id: "intro",
        title: "Intro",
        status: "archived",
        published: "yes",
        summary: "extra",
      }),
    ).toEqual([
      "Status must be one of: draft, published.",
      "Published must be a boolean.",
      "unknown field: summary.",
    ]);
  });

  it("allows partial update payloads but still rejects unknown fields", () => {
    const collection = testCollection();

    expect(
      getCmsDocumentValidationIssues(collection, {}, { partial: true }),
    ).toEqual([]);
    expect(
      getCmsDocumentValidationIssues(
        collection,
        { summary: "extra" },
        { partial: true },
      ),
    ).toEqual(["unknown field: summary."]);
  });
});

function testCollection(): CmsCollectionConfig {
  return {
    name: "lessons",
    label: "Lessons",
    adapter: "github",
    titleField: "title",
    searchFields: ["title"],
    writePolicy: "enabled",
    permissions: {},
    source: { path: "content/lessons", idField: "id", extension: "json" },
    operations: {
      list: true,
      get: true,
      search: true,
      create: true,
      update: true,
      delete: true,
    },
    defaultSort: [],
    fields: [
      { name: "id", type: "id", readOnly: true },
      { name: "title", type: "text", label: "Title", required: true },
      {
        name: "status",
        type: "select",
        label: "Status",
        options: ["draft", "published"],
      },
      { name: "published", type: "boolean", label: "Published" },
    ],
    filters: [],
  };
}
