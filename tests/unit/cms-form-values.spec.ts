import { describe, expect, it } from "vitest";

import {
  buildCmsFormPayload,
  buildCmsFormValues,
} from "@dashboard/lib/components/cms/form-values";
import type { CmsFieldConfig } from "@dashboard/lib/cms/types";

describe("CMS form values", () => {
  it("omits blank optional fields on create", () => {
    expect(
      buildCmsFormPayload(
        [{ field: field("content", "object") }],
        { content: "" },
        { clearBlankValues: false },
      ),
    ).toEqual({});
  });

  it("sends explicit clears for fields emptied on edit", () => {
    expect(
      buildCmsFormPayload(
        [
          { field: field("details", "object") },
          { field: field("labels", "multiSelect") },
        ],
        { details: "", labels: [] },
        {
          clearBlankValues: true,
          originalDocument: {
            details: { items: [{ value: "old" }] },
            labels: ["draft"],
          },
        },
      ),
    ).toEqual({
      details: null,
      labels: [],
    });
  });

  it("does not clear fields that were already blank on edit", () => {
    expect(
      buildCmsFormPayload(
        [
          { field: field("details", "object") },
          { field: field("notes", "textarea") },
          { field: field("labels", "multiSelect") },
        ],
        { details: "", notes: "", labels: [] },
        {
          clearBlankValues: true,
          originalDocument: {
            notes: "",
            labels: [],
          },
        },
      ),
    ).toEqual({});
  });

  it("keeps required blank fields blocked before submit", () => {
    expect(() =>
      buildCmsFormPayload(
        [{ field: { ...field("title", "text"), required: true } }],
        { title: "" },
        { clearBlankValues: true },
      ),
    ).toThrow("title is required.");
  });

  it("serializes object fields for editing", () => {
    expect(
      buildCmsFormValues([{ field: field("details", "object") }], {
        details: { items: [] },
      }),
    ).toEqual({
      details: '{\n  "items": []\n}',
    });
  });
});

function field(name: string, type: CmsFieldConfig["type"]): CmsFieldConfig {
  return { name, type };
}
