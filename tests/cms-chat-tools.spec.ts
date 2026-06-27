import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { CmsConfigState } from "@dashboard/lib/cms/types";

const roles = vi.hoisted(() => ({
  getCmsActorRole: vi.fn(async () => "admin"),
}));

const service = vi.hoisted(() => ({
  listCmsCollections: vi.fn(
    async (): Promise<CmsConfigState> => ({
      configured: true,
      version: 1,
      name: "Example CMS",
      environment: "default",
      writePolicy: "enabled",
      actorRole: "admin",
      permissions: {},
      collections: [
        {
          name: "lessons",
          label: "Lessons",
          adapter: "github",
          mcpName: "lessons",
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
            {
              name: "title",
              type: "text",
              label: "Title",
              description: "Public lesson title",
              placeholder: "Intro to algebra",
              required: true,
              display: { role: "primary", width: "fill" },
              validation: { minLength: 3 },
            },
          ],
          filters: [],
        },
      ],
    }),
  ),
  listCmsDocuments: vi.fn(async () => ({
    docs: [{ _id: "1", title: "Intro" }],
    total: 1,
    limit: 10,
    offset: 0,
  })),
  getCmsDocument: vi.fn(async () => ({ _id: "1", title: "Intro" })),
  createCmsDocument: vi.fn(),
  updateCmsDocument: vi.fn(async () => ({ _id: "1", title: "Updated" })),
  deleteCmsDocument: vi.fn(),
}));

vi.mock("@dashboard/lib/cms/roles", () => roles);
vi.mock("@dashboard/lib/cms/service", () => service);

import { createCmsTools } from "../app/api/kody/chat/tools/cms-tools";

describe("CMS chat tools", () => {
  it("exposes compact generic CMS tools to Kody chat", async () => {
    const req = new NextRequest("https://dash.test/api/kody/chat/kody", {
      headers: {
        "x-kody-token": "ghp_test",
        "x-kody-owner": "A-Guy-educ",
        "x-kody-repo": "A-Guy-Web",
      },
    });

    const tools = await createCmsTools({
      req,
      octokit: {} as never,
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
    });

    expect(Object.keys(tools)).toEqual([
      "cms_list_collections",
      "cms_describe_collection",
      "cms_list_documents",
      "cms_get_document",
      "cms_mutate_document",
    ]);

    const collections = await tools.cms_list_collections.execute?.(
      {},
      { toolCallId: "call-0", messages: [] },
    );

    expect(collections).toMatchObject({
      collections: [
        {
          name: "lessons",
          adapter: "github",
          source: { path: "content/lessons", idField: "id", extension: "json" },
          storage: {
            kind: "github-json",
            path: "content/lessons",
            idField: "id",
            extension: "json",
            branch: "kody-state",
          },
          writePolicy: "enabled",
          operations: { create: true, update: true, delete: true },
          fields: [
            { name: "id", type: "id", readOnly: true },
            {
              name: "title",
              type: "text",
              label: "Title",
              description: "Public lesson title",
              placeholder: "Intro to algebra",
              required: true,
              display: { role: "primary", width: "fill" },
              validation: { minLength: 3 },
            },
          ],
        },
      ],
    });

    const result = await tools.cms_list_documents.execute?.(
      { collection: "lessons", q: "intro", limit: 10 },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toMatchObject({
      docs: [{ _id: "1", title: "Intro" }],
      total: 1,
    });
    expect(service.listCmsDocuments).toHaveBeenCalledWith(
      req,
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Web",
      "lessons",
      expect.objectContaining({
        search: { query: "intro" },
        limit: 10,
      }),
    );
  });

  it("routes writes through the generic mutation tool", async () => {
    const req = new NextRequest("https://dash.test/api/kody/chat/kody");
    const tools = await createCmsTools({
      req,
      octokit: {} as never,
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
    });

    const result = await tools.cms_mutate_document.execute?.(
      {
        collection: "lessons",
        operation: "update",
        id: "1",
        data: { title: "Updated" },
      },
      { toolCallId: "call-2", messages: [] },
    );

    expect(result).toEqual({ document: { _id: "1", title: "Updated" } });
    expect(service.updateCmsDocument).toHaveBeenCalledWith(
      req,
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Web",
      "lessons",
      "1",
      { title: "Updated" },
    );
  });
});
