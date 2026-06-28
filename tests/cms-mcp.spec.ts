import { describe, expect, it } from "vitest";

import { generateCmsMcpTools, resolveCmsMcpTool } from "@dashboard/lib/cms/mcp";
import type { CmsPublicConfig } from "@dashboard/lib/cms/types";

const cms: CmsPublicConfig = {
  configured: true,
  version: 1,
  name: "Example CMS",
  environment: "default",
  writePolicy: "enabled",
  actorRole: "admin",
  permissions: {
    content: {
      list: ["viewer", "editor", "admin"],
      get: ["viewer", "editor", "admin"],
      search: ["viewer", "editor", "admin"],
      create: ["editor", "admin"],
      update: ["editor", "admin"],
      delete: ["admin"],
    },
    schema: {
      generate: ["admin"],
      refresh: ["admin"],
      edit: ["admin"],
    },
  },
  collections: [
    {
      name: "lessons",
      label: "Lessons",
      adapter: "mongodb",
      mcpName: "lessons",
      titleField: "title",
      searchFields: ["title"],
      writePolicy: "enabled",
      permissions: {},
      source: { collection: "lessons", idField: "_id" },
      operations: {
        list: true,
        get: true,
        search: true,
        create: true,
        update: true,
        delete: true,
      },
      defaultSort: [{ field: "updatedAt", direction: "desc" }],
      fields: [
        { name: "_id", type: "id", label: "ID", readOnly: true },
        { name: "title", type: "text", required: true },
        {
          name: "status",
          type: "select",
          options: ["draft", "published"],
        },
        { name: "chapter", type: "relation", target: "chapters" },
        { name: "relatedLessons", type: "relationMany", target: "lessons" },
        { name: "metadata", type: "object" },
        { name: "updatedAt", type: "date", readOnly: true },
      ],
      filters: [],
    },
  ],
};

describe("CMS MCP tool generation", () => {
  it("generates collection CRUD tools from the CMS schema", () => {
    const tools = generateCmsMcpTools(cms);
    expect(tools.map((tool) => tool.name)).toEqual([
      "cms_list_collections",
      "cms_list_lessons",
      "cms_get_lessons",
      "cms_create_lessons",
      "cms_update_lessons",
      "cms_delete_lessons",
    ]);

    const createTool = tools.find((tool) => tool.name === "cms_create_lessons");
    const listTool = tools.find((tool) => tool.name === "cms_list_lessons");
    const getTool = tools.find((tool) => tool.name === "cms_get_lessons");
    const updateTool = tools.find((tool) => tool.name === "cms_update_lessons");

    expect(listTool?.description).toContain("cmsDocumentId");
    expect(getTool?.inputSchema).toMatchObject({
      properties: {
        id: { description: expect.stringContaining("cmsDocumentId") },
      },
    });
    expect(updateTool?.inputSchema).toMatchObject({
      properties: {
        id: { description: expect.stringContaining("cmsDocumentId") },
      },
    });
    expect(createTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        data: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            status: { type: "string", enum: ["draft", "published"] },
            chapter: { type: "string" },
            relatedLessons: {
              type: "array",
              items: { type: "string" },
            },
            metadata: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
      },
      required: ["data"],
    });
  });

  it("resolves generated tool names back to collection operations", () => {
    expect(resolveCmsMcpTool(cms, "cms_update_lessons")).toEqual({
      action: "update",
      collection: "lessons",
    });
    expect(resolveCmsMcpTool(cms, "cms_list_collections")).toEqual({
      action: "list",
      collection: "",
    });
    expect(resolveCmsMcpTool(cms, "cms_update_missing")).toBeNull();
  });

  it("does not expose delete tools when delete is disabled", () => {
    const lockedCms: CmsPublicConfig = {
      ...cms,
      collections: [
        {
          ...cms.collections[0],
          operations: {
            ...cms.collections[0].operations,
            delete: false,
          },
        },
      ],
    };

    expect(
      generateCmsMcpTools(lockedCms).map((tool) => tool.name),
    ).not.toContain("cms_delete_lessons");
    expect(resolveCmsMcpTool(lockedCms, "cms_delete_lessons")).toBeNull();
  });
});
