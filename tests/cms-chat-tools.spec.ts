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
      idField: "id",
      docs: [{ _id: "1", title: "Intro", cmsDocumentId: "1" }],
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

  it("describes CMS tools as the same source used by Content Entries", async () => {
    const req = new NextRequest("https://dash.test/api/kody/chat/kody");
    const tools = await createCmsTools({
      req,
      octokit: {} as never,
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
    });

    const descriptions = [
      tools.cms_list_collections,
      tools.cms_describe_collection,
      tools.cms_list_documents,
      tools.cms_get_document,
      tools.cms_mutate_document,
    ].map((tool) => (tool as { description?: string }).description ?? "");

    for (const description of descriptions) {
      expect(description).toContain("same Dashboard CMS service");
      expect(description).toContain("Content Entries");
      expect(description).toContain("configured collection adapter");
    }
  });

  it("normalizes current-page URLs before getting a CMS document", async () => {
    const req = new NextRequest("https://dash.test/api/kody/chat/kody");
    const tools = await createCmsTools({
      req,
      octokit: {} as never,
      owner: "A-Guy-educ",
      repo: "A-Guy-Admin",
    });

    await tools.cms_get_document.execute?.(
      {
        collection: "courses",
        id: "/content/entries/courses/64f1a5f6f2a80f3a3a3a3a3a/edit?filters=%7B%7D&offset=50",
      },
      { toolCallId: "call-url", messages: [] },
    );
    await tools.cms_get_document.execute?.(
      {
        collection: "courses",
        id: "64f1a5f6f2a80f3a3a3a3a3a?collectionSearch=course",
      },
      { toolCallId: "call-query", messages: [] },
    );
    await tools.cms_get_document.execute?.(
      {
        collection: "courses",
        id: "`64f1a5f6f2a80f3a3a3a3a3a/edit?collectionSearch=course`",
      },
      { toolCallId: "call-partial-edit", messages: [] },
    );
    await tools.cms_mutate_document.execute?.(
      {
        collection: "courses",
        operation: "update",
        id: "https://dash.test/content/entries/courses/64f1a5f6f2a80f3a3a3a3a3a?filters=%7B%7D",
        data: { title: "Updated" },
      },
      { toolCallId: "call-mutate-url", messages: [] },
    );

    expect(service.getCmsDocument).toHaveBeenNthCalledWith(
      1,
      req,
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Admin",
      "courses",
      "64f1a5f6f2a80f3a3a3a3a3a",
    );
    expect(service.getCmsDocument).toHaveBeenNthCalledWith(
      2,
      req,
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Admin",
      "courses",
      "64f1a5f6f2a80f3a3a3a3a3a",
    );
    expect(service.getCmsDocument).toHaveBeenNthCalledWith(
      3,
      req,
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Admin",
      "courses",
      "64f1a5f6f2a80f3a3a3a3a3a",
    );
    expect(service.updateCmsDocument).toHaveBeenCalledWith(
      req,
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Admin",
      "courses",
      "64f1a5f6f2a80f3a3a3a3a3a",
      { title: "Updated" },
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

  it("does not advertise delete mutations when delete is disabled for every collection", async () => {
    service.listCmsCollections.mockResolvedValueOnce({
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
            delete: false,
          },
          defaultSort: [],
          fields: [{ name: "id", type: "id", readOnly: true }],
          filters: [],
        },
      ],
    });

    const req = new NextRequest("https://dash.test/api/kody/chat/kody");
    const tools = await createCmsTools({
      req,
      octokit: {} as never,
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
    });

    const schema = tools.cms_mutate_document.inputSchema as {
      safeParse(input: unknown): { success: boolean };
    };

    expect(
      schema.safeParse({
        collection: "lessons",
        operation: "update",
        id: "1",
        data: { title: "Updated" },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        collection: "lessons",
        operation: "delete",
        id: "1",
      }).success,
    ).toBe(false);
  });
});
