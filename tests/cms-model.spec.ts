import { describe, expect, it } from "vitest";

import {
  cmsCollectionFromModelDraft,
  cmsModelResourceDraftFromCollection,
  validateCmsModelDraft,
} from "@dashboard/lib/cms/model/draft";
import {
  sanitizeCmsModelCollectionPayload,
  sortCmsCollectionEntries,
} from "@dashboard/lib/cms/model/server";
import type { CmsCollectionConfig } from "@dashboard/lib/cms/types";

const chapters: CmsCollectionConfig = {
  name: "chapters",
  label: "Chapters",
  adapter: "mongodb",
  titleField: "title",
  searchFields: ["title"],
  writePolicy: "enabled",
  source: { collection: "chapters", idField: "_id" },
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
    { name: "_id", type: "id", label: "ID", readOnly: true },
    { name: "title", type: "text", label: "Title" },
  ],
  filters: [],
};

const lessons: CmsCollectionConfig = {
  name: "lessons",
  label: "Lessons",
  adapter: "mongodb",
  titleField: "title",
  searchFields: ["title"],
  writePolicy: "enabled",
  source: { collection: "lessons", idField: "_id" },
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
    { name: "_id", type: "id", label: "ID", readOnly: true },
    { name: "title", type: "text", label: "Title", required: true },
    {
      name: "chapter",
      type: "relation",
      label: "Chapter",
      target: "chapters",
      valueField: "_id",
      labelField: "title",
      storage: { kind: "objectId" },
    },
    {
      name: "relatedLessons",
      type: "relationMany",
      label: "Related Lessons",
      target: "lessons",
      storage: { kind: "objectIdArray" },
    },
  ],
  filters: [],
};

describe("CMS model draft rules", () => {
  it("preserves relation fields through draft conversion", () => {
    const draft = cmsModelResourceDraftFromCollection(lessons);
    const collection = cmsCollectionFromModelDraft(draft);
    const fields = new Map(
      collection.fields.map((field) => [field.name, field]),
    );

    expect(fields.get("chapter")).toMatchObject({
      type: "relation",
      target: "chapters",
      valueField: "_id",
      labelField: "title",
      storage: { kind: "objectId" },
    });
    expect(fields.get("relatedLessons")).toMatchObject({
      type: "relationMany",
      target: "lessons",
      storage: { kind: "objectIdArray" },
    });
  });

  it("reports duplicate fields and broken relation targets", () => {
    const draft = cmsModelResourceDraftFromCollection(lessons);
    draft.fields.push({ ...draft.fields[0], key: "duplicate-title" });
    draft.fields[1] = {
      ...draft.fields[1],
      target: "missing",
    };

    expect(
      validateCmsModelDraft({
        draft,
        collections: [lessons, chapters],
        originalName: "lessons",
      }).map((issue) => issue.message),
    ).toEqual(
      expect.arrayContaining([
        "Duplicate field: title.",
        "Chapter targets unknown resource: missing.",
      ]),
    );
  });

  it("blocks create-time resource name collisions", () => {
    const draft = cmsModelResourceDraftFromCollection(lessons);

    expect(
      validateCmsModelDraft({
        draft,
        collections: [lessons, chapters],
        originalName: null,
      }).map((issue) => issue.message),
    ).toContain('Resource "lessons" already exists.');
  });

  it("keeps relation metadata while sanitizing a save payload", () => {
    const collection = sanitizeCmsModelCollectionPayload(
      { collection: lessons, originalName: "lessons" },
      {
        existingCollections: [lessons, chapters],
        originalName: "lessons",
      },
    );
    const fields = new Map(
      collection.fields.map((field) => [field.name, field]),
    );

    expect(fields.get("chapter")).toMatchObject({
      type: "relation",
      target: "chapters",
      valueField: "_id",
      labelField: "title",
      storage: { kind: "objectId" },
    });
  });

  it("sorts collection refs when adding a resource", () => {
    expect(
      sortCmsCollectionEntries([
        "collections/lessons.json",
        "collections/authors.json",
        "collections/chapters.json",
      ]),
    ).toEqual([
      "collections/authors.json",
      "collections/chapters.json",
      "collections/lessons.json",
    ]);
  });
});
