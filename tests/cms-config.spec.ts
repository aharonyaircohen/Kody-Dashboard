import { describe, expect, it, vi, beforeEach } from "vitest";

const stateRepo = vi.hoisted(() => ({
  readStateText: vi.fn(),
}));

vi.mock("@dashboard/lib/state-repo", () => stateRepo);

import {
  invalidateCmsConfigCache,
  loadCmsConfigFromState,
  normalizeCmsConfig,
  normalizeSearchQuery,
  normalizeSortQuery,
} from "@dashboard/lib/cms/config";
import { readStateText } from "@dashboard/lib/state-repo";

describe("CMS config contract", () => {
  const mockReadStateText = vi.mocked(readStateText);

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCmsConfigCache();
  });

  it("treats a missing root cms/config.json as unconfigured", async () => {
    mockReadStateText.mockResolvedValueOnce(null);

    await expect(
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Web"),
    ).resolves.toBeNull();

    expect(readStateText).toHaveBeenCalledWith(
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Web",
      "cms/config.json",
    );
  });

  it("still fails when a referenced CMS file is missing", async () => {
    mockReadStateText
      .mockResolvedValueOnce({
        path: "A-Guy-Admin/cms/config.json",
        sha: "config-sha",
        content: JSON.stringify({
          version: 1,
          collections: ["collections/lessons.json"],
        }),
      })
      .mockResolvedValueOnce(null);

    await expect(
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Admin"),
    ).rejects.toMatchObject({
      name: "CmsConfigError",
      code: "cms_config_error",
      message: "missing state file: cms/collections/lessons.json",
    });
  });

  it("dedupes concurrent config loads", async () => {
    mockReadStateText.mockResolvedValue({
      path: "A-Guy-Web/cms/config.json",
      sha: "config-sha",
      content: JSON.stringify({
        version: 1,
        defaultAdapter: "memory",
        collections: {
          lessons: {
            name: "lessons",
            fields: [{ name: "title", type: "text" }],
          },
        },
      }),
    });

    const [first, second] = await Promise.all([
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Web"),
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Web"),
    ]);

    expect(first).toEqual(second);
    expect(readStateText).toHaveBeenCalledTimes(1);
  });

  it("normalizes environment-materialized collection maps", () => {
    const config = normalizeCmsConfig({
      version: 1,
      name: "Example CMS",
      environment: "dev",
      defaultAdapter: "content-store",
      writePolicy: "read-only",
      adapters: {
        "content-store": {
          endpointSecret: "DATABASE_URL",
          workspace: "development",
        },
      },
      collections: {
        lessons: {
          name: "lessons",
          label: "Lessons",
          source: { collection: "lessons", idField: "_id" },
          titleField: "title",
          listFields: ["title", "chapter", "updatedAt"],
          views: {
            list: {
              pageSize: 50,
              fields: [
                { name: "title", role: "primary", width: "fill" },
                { name: "chapter", display: "label", width: "sm" },
                { name: "updatedAt", sortable: false },
              ],
            },
            detail: { fields: ["_id", "title", "chapter", "updatedAt"] },
            form: { fields: ["title", "chapter"] },
          },
          fields: [
            { name: "_id", type: "id", label: "ID", readOnly: true },
            { name: "title", type: "text", label: "Title" },
            {
              name: "chapter",
              type: "relation",
              label: "Chapter",
              target: "chapters",
            },
            { name: "updatedAt", type: "date", label: "Updated At" },
          ],
          filters: [
            { field: "title", operators: ["contains", "equals"] },
            { field: "chapter", operators: ["equals"] },
          ],
        },
      },
    });

    expect(config.collections.lessons.adapter).toBe("content-store");
    expect(config.collections.lessons.writePolicy).toBe("read-only");
    expect(config.collections.lessons.searchFields).toEqual(["title"]);
    expect(config.collections.lessons.listFields).toEqual([
      "title",
      "chapter",
      "updatedAt",
    ]);
    expect(config.collections.lessons.views?.list?.pageSize).toBe(50);
    expect(config.collections.lessons.views?.list?.fields).toEqual([
      { name: "title", role: "primary", width: "fill" },
      { name: "chapter", display: "label", width: "sm" },
      { name: "updatedAt", sortable: false },
    ]);
    expect(config.collections.lessons.views?.detail?.fields).toEqual([
      { name: "_id" },
      { name: "title" },
      { name: "chapter" },
      { name: "updatedAt" },
    ]);
    expect(config.collections.lessons.views?.form?.fields).toEqual([
      { name: "title" },
      { name: "chapter" },
    ]);
    expect(config.collections.lessons.operations).toMatchObject({
      list: true,
      get: true,
      search: true,
      create: false,
      update: false,
      delete: false,
    });
    expect(config.adapters["content-store"].workspace).toBe("development");
  });

  it("preserves opaque adapter settings", () => {
    const config = normalizeCmsConfig({
      version: 1,
      name: "Example CMS",
      environment: "dev",
      defaultAdapter: "example",
      writePolicy: "read-only",
      adapters: {
        example: {
          secretName: "DATABASE_URL",
          region: "local",
          preview: true,
        },
      },
      collections: {
        lessons: {
          name: "lessons",
          fields: [{ name: "_id", type: "id" }],
        },
      },
    });

    expect(config.adapters.example).toEqual({
      secretName: "DATABASE_URL",
      region: "local",
      preview: true,
    });
  });

  it("requires collection adapter when no default adapter is set", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          lessons: {
            name: "lessons",
            fields: [{ name: "title", type: "text" }],
          },
        },
      }),
    ).toThrow(/lessons\.adapter required when defaultAdapter is not set/);
  });

  it("rejects unknown field types", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          lessons: {
            name: "lessons",
            fields: [{ name: "title", type: "madeUp" }],
          },
        },
      }),
    ).toThrow(/type is invalid/);
  });

  it("rejects list fields that are not configured fields", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          lessons: {
            name: "lessons",
            listFields: ["title", "missing"],
            fields: [{ name: "title", type: "text" }],
          },
        },
      }),
    ).toThrow(/listFields references unknown field: missing/);
  });

  it("rejects view fields that are not configured fields", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          lessons: {
            name: "lessons",
            views: { list: { fields: ["missing"] } },
            fields: [{ name: "title", type: "text" }],
          },
        },
      }),
    ).toThrow(/views\.list\.fields references unknown field: missing/);
  });

  it("rejects default sort fields that are not configured fields", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          lessons: {
            name: "lessons",
            fields: [{ name: "title", type: "text" }],
            defaultSort: [{ field: "missing", direction: "asc" }],
          },
        },
      }),
    ).toThrow(/defaultSort references unknown field: missing/);
  });

  it("rejects search fields that are not configured fields", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          lessons: {
            name: "lessons",
            fields: [{ name: "title", type: "text" }],
            searchFields: ["missing"],
          },
        },
      }),
    ).toThrow(/searchFields references unknown field: missing/);
  });

  it("validates runtime sort query fields against collection fields", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "memory",
      collections: {
        lessons: {
          name: "lessons",
          fields: [
            { name: "_id", type: "id" },
            { name: "title", type: "text" },
          ],
        },
      },
    });

    expect(
      normalizeSortQuery(config.collections.lessons, [
        { field: "title", direction: "asc" },
      ]),
    ).toEqual([{ field: "title", direction: "asc" }]);
    expect(() =>
      normalizeSortQuery(config.collections.lessons, [
        { field: "$where", direction: "desc" },
      ]),
    ).toThrow(/unknown sort field: \$where/);
  });

  it("validates runtime search query fields against collection fields", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "memory",
      collections: {
        courses: {
          name: "courses",
          titleField: "title",
          fields: [
            { name: "_id", type: "id" },
            { name: "title", type: "text" },
          ],
        },
      },
    });

    expect(
      normalizeSearchQuery(config.collections.courses, {
        query: "math",
      }),
    ).toEqual({ query: "math", fields: ["title"] });
    expect(() =>
      normalizeSearchQuery(config.collections.courses, {
        query: "math",
        fields: ["missing"],
      }),
    ).toThrow(/unknown search field: missing/);
  });
});
