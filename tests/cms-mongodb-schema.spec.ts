import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";

const mongo = vi.hoisted(() => {
  const collections = new Map<string, unknown[]>();
  const db = {
    listCollections: vi.fn(() => ({
      toArray: vi.fn(async () =>
        [...collections.keys()].map((name) => ({ name })),
      ),
    })),
    collection: vi.fn((name: string) => ({
      find: vi.fn(() => ({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn(async () => collections.get(name) ?? []),
      })),
    })),
  };
  const client = {
    connect: vi.fn(async () => client),
    close: vi.fn(async () => undefined),
    db: vi.fn(() => db),
  };

  return { collections, client, db };
});

vi.mock("mongodb", async () => {
  const actual = await vi.importActual<typeof import("mongodb")>("mongodb");
  return {
    ...actual,
    MongoClient: vi.fn(function MongoClient() {
      return mongo.client;
    }),
  };
});

import { generateMongoCmsSchemaFiles } from "@dashboard/lib/cms/schema/mongodb";

describe("Mongo CMS schema generation", () => {
  it("emits storage metadata for ObjectId, dates, arrays, and string ID relations", async () => {
    const chapterId = new ObjectId("64f1a5f6f2a80f3a3a3a3a3a");
    const lessonId = new ObjectId("64f1a5f6f2a80f3a3a3a3a3b");

    mongo.collections.clear();
    mongo.collections.set("chapters", [
      {
        _id: chapterId,
        title: "Chapter 1",
      },
    ]);
    mongo.collections.set("lessons", [
      {
        _id: lessonId,
        title: "Lesson 1",
        chapter: chapterId,
        chapterId: chapterId.toHexString(),
        grid: chapterId.toHexString(),
        relatedLessons: [lessonId],
        tags: ["math", "science"],
        status: "draft",
        publishedAt: "2026-01-03T04:05:06.000Z",
        metadata: { duration: 12 },
        blocks: [{ type: "text", value: "Intro" }],
        updatedAt: new Date("2026-01-02T03:04:05.000Z"),
      },
    ]);

    const generated = await generateMongoCmsSchemaFiles({
      uri: "mongodb://localhost/a-guy-dev",
      databaseUriSecret: "DATABASE_URL",
      repoName: "A-Guy-Web",
      cmsName: "A-Guy CMS",
      environment: "development",
      sampleSize: 20,
      skipCollections: [],
    });

    const lessonsFile = generated.files.find(
      (file) => file.path === "cms/collections/lessons.json",
    );
    expect(lessonsFile).toBeTruthy();

    const lessons = JSON.parse(lessonsFile?.content ?? "{}") as {
      fields: Array<{
        name: string;
        type: string;
        target?: string;
        storage?: { kind: string };
      }>;
    };
    const fields = new Map(lessons.fields.map((field) => [field.name, field]));

    expect(fields.get("_id")).toMatchObject({
      type: "id",
      storage: { kind: "objectId" },
    });
    expect(fields.get("chapter")).toMatchObject({
      type: "relation",
      target: "chapters",
      storage: { kind: "objectId" },
    });
    expect(fields.get("chapterId")).toMatchObject({
      type: "relation",
      target: "chapters",
      storage: { kind: "objectId" },
    });
    expect(fields.get("grid")).not.toMatchObject({
      type: "relation",
      storage: { kind: "objectId" },
    });
    expect(fields.get("relatedLessons")).toMatchObject({
      type: "relationMany",
      target: "lessons",
      storage: { kind: "objectIdArray" },
    });
    expect(fields.get("tags")).toMatchObject({
      type: "multiSelect",
      storage: { kind: "stringArray" },
    });
    expect(fields.get("status")).toMatchObject({
      type: "select",
    });
    expect(fields.get("status")?.storage).toBeUndefined();
    expect(fields.get("publishedAt")).toMatchObject({
      type: "date",
      storage: { kind: "dateString" },
    });
    expect(fields.get("metadata")).toMatchObject({
      type: "object",
      storage: { kind: "object" },
    });
    expect(fields.get("blocks")).toMatchObject({
      type: "array",
      storage: { kind: "array" },
    });
    expect(fields.get("updatedAt")).toMatchObject({
      type: "date",
      storage: { kind: "date" },
    });
  });

  it("writes slugged CMS files for Mongo collections with uppercase names", async () => {
    mongo.collections.clear();
    mongo.collections.set("A", [
      {
        _id: new ObjectId("64f1a5f6f2a80f3a3a3a3a3c"),
        title: "Example",
      },
    ]);

    const generated = await generateMongoCmsSchemaFiles({
      uri: "mongodb://localhost/a-guy-dev",
      databaseUriSecret: "DATABASE_URL",
      repoName: "A-Guy-Admin",
      cmsName: "A-Guy CMS",
      environment: "development",
      sampleSize: 20,
      skipCollections: [],
    });

    const collectionFile = generated.files.find(
      (file) => file.path === "cms/collections/a.json",
    );
    const rootConfig = generated.files.find(
      (file) => file.path === "cms/config.json",
    );

    expect(collectionFile).toBeTruthy();
    expect(JSON.parse(rootConfig?.content ?? "{}")).toMatchObject({
      collections: ["collections/a.json"],
    });
    expect(JSON.parse(collectionFile?.content ?? "{}")).toMatchObject({
      name: "a",
      label: "A",
      source: { collection: "A", idField: "_id" },
    });
  });

  it("preserves skipped collections when generating schema", async () => {
    mongo.collections.clear();
    mongo.collections.set("A", [{ _id: new ObjectId(), title: "Hidden" }]);
    mongo.collections.set("Lessons", [
      { _id: new ObjectId(), title: "Visible" },
    ]);

    const generated = await generateMongoCmsSchemaFiles({
      uri: "mongodb://localhost/a-guy-dev",
      databaseUriSecret: "DATABASE_URL",
      repoName: "A-Guy-Admin",
      cmsName: "A-Guy CMS",
      environment: "development",
      sampleSize: 20,
      skipCollections: ["A"],
    });

    expect(
      generated.files.some((file) => file.path === "cms/collections/a.json"),
    ).toBe(false);
    expect(
      generated.files.some(
        (file) => file.path === "cms/collections/lessons.json",
      ),
    ).toBe(true);
    const rootConfig = generated.files.find(
      (file) => file.path === "cms/config.json",
    );
    expect(JSON.parse(rootConfig?.content ?? "{}")).toMatchObject({
      schemaGeneration: { skipCollections: ["A"] },
      collections: ["collections/lessons.json"],
    });
  });
});
