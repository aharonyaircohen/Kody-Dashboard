import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

import {
  buildMongoWriteDocument,
  buildMongoQuery,
  getMongoDatabase,
  normalizeMongoValue,
} from "@dashboard/lib/cms/adapters/mongodb";
import type { CmsCollectionConfig } from "@dashboard/lib/cms/types";

const collection: CmsCollectionConfig = {
  name: "lessons",
  label: "Lessons",
  adapter: "mongodb",
  writePolicy: "read-only",
  searchFields: ["title"],
  source: { collection: "lessons", idField: "_id" },
  operations: {
    list: true,
    get: true,
    search: true,
    create: false,
    update: false,
    delete: false,
  },
  defaultSort: [{ field: "updatedAt", direction: "desc" }],
  fields: [
    { name: "_id", type: "id" },
    { name: "title", type: "text" },
    { name: "chapter", type: "relation" },
    { name: "status", type: "select" },
    { name: "isActive", type: "boolean" },
    { name: "order", type: "number" },
    { name: "updatedAt", type: "date" },
  ],
  filters: [
    { field: "chapter", operators: ["equals"] },
    { field: "status", operators: ["equals", "in"] },
    { field: "isActive", operators: ["equals"] },
    { field: "updatedAt", operators: ["greater_than_equal"] },
  ],
};

describe("CMS Mongo adapter helpers", () => {
  it("normalizes ObjectId and Date values recursively", () => {
    const id = new ObjectId("64f1a5f6f2a80f3a3a3a3a3a");
    const normalized = normalizeMongoValue({
      _id: id,
      chapter: id,
      updatedAt: new Date("2026-01-02T03:04:05.000Z"),
      nested: [{ id }],
    });

    expect(normalized).toEqual({
      _id: "64f1a5f6f2a80f3a3a3a3a3a",
      chapter: "64f1a5f6f2a80f3a3a3a3a3a",
      updatedAt: "2026-01-02T03:04:05.000Z",
      nested: [{ id: "64f1a5f6f2a80f3a3a3a3a3a" }],
    });
  });

  it("coerces relation, boolean, and date filters for Mongo", () => {
    const chapter = "64f1a5f6f2a80f3a3a3a3a3a";
    const query = buildMongoQuery(collection, {
      chapter: { equals: chapter },
      isActive: { equals: "true" },
      updatedAt: { greater_than_equal: "2026-01-02T03:04:05.000Z" },
    });

    expect((query.chapter as { $in: unknown[] }).$in[0]).toBeInstanceOf(
      ObjectId,
    );
    expect(String((query.chapter as { $in: unknown[] }).$in[0])).toBe(chapter);
    expect((query.chapter as { $in: unknown[] }).$in[1]).toBe(chapter);
    expect(query.isActive).toBe(true);
    expect((query.updatedAt as { $gte: unknown }).$gte).toBeInstanceOf(Date);
  });

  it("builds text search across configured search fields", () => {
    const query = buildMongoQuery(
      collection,
      {},
      {
        query: "Course 1",
        fields: ["title"],
      },
    );

    expect(query).toEqual({
      $or: [{ title: { $regex: "Course 1", $options: "i" } }],
    });
  });

  it("rejects filters that are not enabled by config", () => {
    expect(() =>
      buildMongoQuery(collection, {
        missing: { contains: "intro" },
      }),
    ).toThrow(/unknown filter field/);
  });
  it("builds typed Mongo write documents from configured writable fields", () => {
    const chapter = "64f1a5f6f2a80f3a3a3a3a3a";
    const payload = buildMongoWriteDocument(
      {
        ...collection,
        fields: [
          ...collection.fields,
          { name: "title", type: "text", required: true },
        ],
      },
      {
        title: "Intro",
        chapter,
        isActive: "true",
        order: "12",
        updatedAt: "2026-01-02T03:04:05.000Z",
      },
      { requireRequiredFields: true },
    );

    expect(payload.title).toBe("Intro");
    expect(payload.chapter).toBeInstanceOf(ObjectId);
    expect(String(payload.chapter)).toBe(chapter);
    expect(payload.isActive).toBe(true);
    expect(payload.order).toBe(12);
    expect(payload.updatedAt).toBeInstanceOf(Date);
  });

  it("uses storage metadata when writing Mongo values", () => {
    const chapter = "64f1a5f6f2a80f3a3a3a3a3a";
    const payload = buildMongoWriteDocument(
      {
        ...collection,
        fields: [
          { name: "_id", type: "id", readOnly: true },
          {
            name: "chapterId",
            type: "text",
            storage: { kind: "objectId" },
          },
          {
            name: "relatedLessons",
            type: "array",
            storage: { kind: "objectIdArray" },
          },
          {
            name: "publishedAt",
            type: "date",
            storage: { kind: "dateString" },
          },
          {
            name: "tags",
            type: "multiSelect",
            storage: { kind: "stringArray" },
          },
        ],
      },
      {
        chapterId: chapter,
        relatedLessons: `${chapter}, ${chapter}`,
        publishedAt: "2026-01-02T03:04:05.000Z",
        tags: ["math", "science"],
      },
      { requireRequiredFields: true },
    );

    expect(payload.chapterId).toBeInstanceOf(ObjectId);
    expect(String(payload.chapterId)).toBe(chapter);
    expect(payload.relatedLessons).toHaveLength(2);
    expect((payload.relatedLessons as unknown[])[0]).toBeInstanceOf(ObjectId);
    expect(payload.publishedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(payload.tags).toEqual(["math", "science"]);
  });

  it("rejects writes for fields outside the CMS config", () => {
    expect(() =>
      buildMongoWriteDocument(
        collection,
        { summary: "Intro" },
        { requireRequiredFields: false },
      ),
    ).toThrow(/field is not writable: summary/);
  });

  it("uses URI database when databaseName is omitted", () => {
    const db = vi.fn(() => ({ collection: vi.fn() }));

    getMongoDatabase({ db } as never);

    expect(db).toHaveBeenCalledWith();
  });

  it("uses configured databaseName when provided", () => {
    const db = vi.fn(() => ({ collection: vi.fn() }));

    getMongoDatabase({ db } as never, "A-Guy-Dev");

    expect(db).toHaveBeenCalledWith("A-Guy-Dev");
  });
});
