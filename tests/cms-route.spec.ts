import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { CmsConfigError } from "@dashboard/lib/cms/config";
import type { CmsConfigState } from "@dashboard/lib/cms/types";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "A-Guy-educ",
    repo: "A-Guy-Web",
    storeRepoUrl: "https://github.com/A-Guy-educ/kody-state",
    storeRef: "main",
  })),
  getUserOctokit: vi.fn(async () => ({
    __octokit: true,
    repos: {
      getCollaboratorPermissionLevel: vi.fn(async () => ({
        data: { permission: "admin" },
      })),
    },
  })),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "aguy", avatar_url: "", githubId: 1 },
  })),
  resolveActorFromToken: vi.fn(async () => ({
    login: "aguy",
    avatarUrl: "",
    githubId: 1,
  })),
}));

const github = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

const service = vi.hoisted(() => ({
  listCmsCollections: vi.fn(
    async (): Promise<CmsConfigState> => ({
      configured: false,
      collections: [],
    }),
  ),
  listCmsDocuments: vi.fn(async () => ({
    docs: [],
    total: 0,
    limit: 50,
    offset: 0,
  })),
  getCmsDocument: vi.fn(async () => null),
  createCmsDocument: vi.fn(async () => ({ _id: "new-id", title: "Created" })),
  updateCmsDocument: vi.fn(async () => ({ _id: "1", title: "Updated" })),
  deleteCmsDocument: vi.fn(async () => true),
  parseCmsListQuery: vi.fn(() => ({})),
  CmsRuntimeError: class CmsRuntimeError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status = 500) {
      super(message);
      this.name = "CmsRuntimeError";
      this.code = code;
      this.status = status;
    }
  },
}));

const stateRepo = vi.hoisted(() => ({
  readStateText: vi.fn(
    async (..._args: unknown[]): Promise<unknown | null> => null,
  ),
  writeStateText: vi.fn(async (_input: unknown): Promise<void> => undefined),
  writeStateFiles: vi.fn(async (_input: unknown): Promise<void> => undefined),
}));

const mongoSchema = vi.hoisted(() => ({
  generateMongoCmsSchemaFiles: vi.fn(async () => ({
    collectionCount: 1,
    files: [
      {
        path: "cms/config.json",
        content:
          '{\n  "version": 1,\n  "name": "Example CMS",\n  "collections": ["collections/lessons.json"]\n}\n',
      },
      {
        path: "cms/collections/lessons.json",
        content: '{\n  "name": "lessons"\n}\n',
      },
    ],
  })),
}));

const vault = vi.hoisted(() => ({
  getSecret: vi.fn(async () => "mongodb://localhost/a-guy-dev"),
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/github-client", () => github);
vi.mock("@dashboard/lib/cms/service", () => service);
vi.mock("@dashboard/lib/state-repo", () => stateRepo);
vi.mock("@dashboard/lib/cms/adapters/mongodb-schema", () => mongoSchema);
vi.mock("@dashboard/lib/vault/get-secret", () => vault);

import {
  GET as collectionGET,
  POST as collectionPOST,
} from "../app/api/kody/cms/[collection]/route";
import {
  DELETE as documentDELETE,
  GET as documentGET,
  PATCH as documentPATCH,
} from "../app/api/kody/cms/[collection]/[id]/route";
import {
  GET as indexGET,
  PATCH as indexPATCH,
  POST as indexPOST,
} from "../app/api/kody/cms/route";
import {
  DELETE as mcpDELETE,
  GET as mcpGET,
  POST as mcpPOST,
} from "../app/api/kody/cms/mcp/route";
import { POST as schemaPOST } from "../app/api/kody/cms/schema/route";

function request(url = "https://dash.test/api/kody/cms") {
  return new NextRequest(url, {
    headers: {
      "x-kody-token": "ghp_test",
      "x-kody-owner": "A-Guy-educ",
      "x-kody-repo": "A-Guy-Web",
    },
  });
}

function postRequest(body: unknown) {
  return new NextRequest("https://dash.test/api/kody/cms", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "A-Guy-educ",
      "x-kody-repo": "A-Guy-Web",
    },
  });
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "A-Guy-educ",
      "x-kody-repo": "A-Guy-Web",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CMS API routes", () => {
  it("returns configured false when CMS is absent", async () => {
    const res = await indexGET(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      cms: { configured: false, collections: [] },
    });
  });

  it("lists CMS documents with filters, sort, and pagination", async () => {
    const filters = { title: { contains: "Intro" } };
    const ids = ["64f1a5f6f2a80f3a3a3a3a3a", "external-id"];
    service.parseCmsListQuery.mockReturnValueOnce({
      ids,
      filters,
      sort: [
        { field: "title", direction: "asc" },
        { field: "updatedAt", direction: "desc" },
      ],
      limit: 10,
      offset: 20,
    });
    const res = await collectionGET(
      request(
        `https://dash.test/api/kody/cms/lessons?filters=${encodeURIComponent(
          JSON.stringify(filters),
        )}&ids=${ids.join(",")}&sort=title:asc,updatedAt:desc&limit=10&offset=20`,
      ),
      { params: Promise.resolve({ collection: "lessons" }) },
    );

    expect(res.status).toBe(200);
    expect(service.listCmsDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Web",
      "lessons",
      {
        ids,
        filters,
        sort: [
          { field: "title", direction: "asc" },
          { field: "updatedAt", direction: "desc" },
        ],
        limit: 10,
        offset: 20,
      },
    );
    await expect(res.json()).resolves.toMatchObject({
      docs: [],
      total: 0,
    });
  });

  it("creates a neutral CMS config in the state repo", async () => {
    const res = await indexPOST(postRequest({ name: "Example CMS" }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      cms: {
        configured: true,
        version: 1,
        name: "Example CMS",
        environment: "default",
        writePolicy: "read-only",
        collections: [],
      },
    });
    expect(stateRepo.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "A-Guy-educ",
        repo: "A-Guy-Web",
        path: "cms/config.json",
        message: "chore(cms): create CMS config",
      }),
    );
    const write = stateRepo.writeStateText.mock.calls[0][0] as {
      content: string;
    };
    expect(JSON.parse(write.content)).toEqual({
      version: 1,
      name: "Example CMS",
      environment: "default",
      writePolicy: "read-only",
      collections: [],
    });
    expect(auth.verifyActorLogin).not.toHaveBeenCalled();
  });

  it("updates CMS permissions in state repo", async () => {
    const rootConfig = {
      path: "cms/config.json",
      sha: "config-sha",
      content: JSON.stringify({
        version: 1,
        name: "Example CMS",
        environment: "default",
        defaultAdapter: "mongodb",
        writePolicy: "enabled",
        collections: ["collections/lessons.json"],
      }),
    };
    const lessonsConfig = {
      path: "cms/collections/lessons.json",
      sha: "lessons-sha",
      content: JSON.stringify({
        name: "lessons",
        label: "Lessons",
        adapter: "mongodb",
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
        fields: [{ name: "_id", type: "id" }],
        filters: [],
      }),
    };
    stateRepo.readStateText
      .mockResolvedValueOnce(rootConfig)
      .mockResolvedValueOnce(lessonsConfig)
      .mockResolvedValueOnce(rootConfig)
      .mockResolvedValueOnce(lessonsConfig);
    service.listCmsCollections.mockResolvedValueOnce({
      configured: true,
      version: 1,
      name: "Example CMS",
      environment: "default",
      writePolicy: "enabled",
      permissions: {
        content: {
          list: ["viewer", "editor", "admin"],
          get: ["viewer", "editor", "admin"],
          search: ["viewer", "editor", "admin"],
          create: ["editor", "admin"],
          update: ["editor", "admin"],
          delete: ["admin"],
        },
        schema: { generate: ["admin"], refresh: ["admin"], edit: ["admin"] },
      },
      collections: [],
    });

    const res = await indexPATCH(
      jsonRequest("https://dash.test/api/kody/cms", "PATCH", {
        collections: [
          {
            name: "lessons",
            permissions: {
              content: { update: ["editor"], delete: ["admin"] },
            },
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const write = stateRepo.writeStateFiles.mock.calls[0][0] as {
      message: string;
      files: Array<{ path: string; content: string }>;
    };
    expect(write.message).toBe("chore(cms): update CMS permissions");
    const lessonFile = write.files.find(
      (file: { path: string }) => file.path === "cms/collections/lessons.json",
    );
    expect(JSON.parse(lessonFile!.content).permissions.content).toMatchObject({
      update: ["editor", "admin"],
      delete: ["admin"],
    });
  });

  it("does not overwrite an existing CMS config", async () => {
    stateRepo.readStateText.mockResolvedValueOnce({
      path: "A-Guy-Web/cms/config.json",
      content: "{}",
      sha: "sha",
    });

    const res = await indexPOST(postRequest({ name: "Example CMS" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "cms_already_configured",
      message: "CMS is already configured for this repo.",
    });
    expect(stateRepo.writeStateText).not.toHaveBeenCalled();
    expect(auth.verifyActorLogin).not.toHaveBeenCalled();
  });

  it("generates CMS schema into the state repo", async () => {
    stateRepo.readStateText.mockResolvedValueOnce({
      path: "cms/config.json",
      content: JSON.stringify({
        version: 1,
        name: "Example CMS",
        environment: "default",
        writePolicy: "read-only",
        collections: [],
      }),
      sha: "config-sha",
    });
    service.listCmsCollections.mockResolvedValueOnce({
      configured: true,
      version: 1,
      name: "Example CMS",
      environment: "default",
      defaultAdapter: "mongodb",
      writePolicy: "enabled",
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
          source: { collection: "lessons", idField: "_id" },
          searchFields: ["title"],
          writePolicy: "enabled",
          operations: {
            list: true,
            get: true,
            search: true,
            create: true,
            update: true,
            delete: true,
          },
          defaultSort: [],
          fields: [{ name: "_id", type: "id" }],
          filters: [],
        },
      ],
    } as CmsConfigState);

    const res = await schemaPOST(
      jsonRequest("https://dash.test/api/kody/cms/schema", "POST", {
        adapter: "mongodb",
      }),
    );

    expect(res.status).toBe(201);
    expect(vault.getSecret).toHaveBeenCalledWith(
      "DATABASE_URL",
      expect.anything(),
    );
    expect(stateRepo.readStateText).toHaveBeenCalledWith(
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Web",
      "cms/config.json",
    );
    expect(mongoSchema.generateMongoCmsSchemaFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: "mongodb://localhost/a-guy-dev",
        databaseUriSecret: "DATABASE_URL",
        repoName: "A-Guy-Web",
        environment: "default",
        sampleSize: 100,
        skipCollections: [],
      }),
    );
    expect(mongoSchema.generateMongoCmsSchemaFiles).toHaveBeenCalledWith(
      expect.not.objectContaining({ databaseName: "" }),
    );
    expect(stateRepo.writeStateFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "A-Guy-educ",
        repo: "A-Guy-Web",
        message: "chore(cms): generate CMS schema",
      }),
    );
    await expect(res.json()).resolves.toMatchObject({
      generated: { collections: 1 },
      cms: { configured: true, collections: [{ name: "lessons" }] },
    });
  });

  it("does not write an empty generated schema", async () => {
    stateRepo.readStateText.mockResolvedValueOnce({
      path: "cms/config.json",
      content: JSON.stringify({
        version: 1,
        name: "Example CMS",
        collections: [],
      }),
      sha: "config-sha",
    });
    mongoSchema.generateMongoCmsSchemaFiles.mockResolvedValueOnce({
      collectionCount: 0,
      files: [],
    });

    const res = await schemaPOST(
      jsonRequest("https://dash.test/api/kody/cms/schema", "POST", {
        adapter: "mongodb",
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "cms_schema_empty",
      message: "No MongoDB collections found from DATABASE_URL.",
    });
    expect(stateRepo.writeStateFiles).not.toHaveBeenCalled();
  });

  it("does not regenerate schema when collections already exist", async () => {
    stateRepo.readStateText.mockResolvedValueOnce({
      path: "cms/config.json",
      content: JSON.stringify({
        version: 1,
        name: "Example CMS",
        collections: ["collections/lessons.json"],
      }),
      sha: "config-sha",
    });

    const res = await schemaPOST(
      jsonRequest("https://dash.test/api/kody/cms/schema", "POST", {
        adapter: "mongodb",
      }),
    );

    expect(res.status).toBe(409);
    expect(mongoSchema.generateMongoCmsSchemaFiles).not.toHaveBeenCalled();
    expect(stateRepo.writeStateFiles).not.toHaveBeenCalled();
  });

  it("refreshes schema when collections already exist and refresh is explicit", async () => {
    stateRepo.readStateText.mockResolvedValueOnce({
      path: "cms/config.json",
      content: JSON.stringify({
        version: 1,
        name: "Example CMS",
        collections: ["collections/lessons.json"],
      }),
      sha: "config-sha",
    });
    service.listCmsCollections.mockResolvedValueOnce({
      configured: true,
      version: 1,
      name: "Example CMS",
      environment: "default",
      defaultAdapter: "mongodb",
      writePolicy: "enabled",
      collections: [{ name: "lessons" }],
    } as CmsConfigState);

    const res = await schemaPOST(
      jsonRequest("https://dash.test/api/kody/cms/schema", "POST", {
        adapter: "mongodb",
        refresh: true,
      }),
    );

    expect(res.status).toBe(200);
    expect(mongoSchema.generateMongoCmsSchemaFiles).toHaveBeenCalled();
    expect(stateRepo.writeStateFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "A-Guy-educ",
        repo: "A-Guy-Web",
        message: "chore(cms): update CMS schema",
      }),
    );
    await expect(res.json()).resolves.toMatchObject({
      generated: { collections: 1, refreshed: true },
      cms: { configured: true, collections: [{ name: "lessons" }] },
    });
  });

  it("creates a CMS document through collection route", async () => {
    const res = await collectionPOST(
      jsonRequest("https://dash.test/api/kody/cms/lessons", "POST", {
        title: "Created",
      }),
      { params: Promise.resolve({ collection: "lessons" }) },
    );

    expect(res.status).toBe(201);
    expect(auth.verifyActorLogin).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
    );
    expect(service.createCmsDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Web",
      "lessons",
      { title: "Created" },
    );
    await expect(res.json()).resolves.toMatchObject({
      document: { _id: "new-id", title: "Created" },
    });
  });

  it("updates a CMS document through document route", async () => {
    const res = await documentPATCH(
      jsonRequest("https://dash.test/api/kody/cms/lessons/1", "PATCH", {
        title: "Updated",
      }),
      { params: Promise.resolve({ collection: "lessons", id: "1" }) },
    );

    expect(res.status).toBe(200);
    expect(service.updateCmsDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Web",
      "lessons",
      "1",
      { title: "Updated" },
    );
    await expect(res.json()).resolves.toMatchObject({
      document: { _id: "1", title: "Updated" },
    });
  });

  it("deletes a CMS document through document route", async () => {
    const res = await documentDELETE(
      request("https://dash.test/api/kody/cms/lessons/1"),
      { params: Promise.resolve({ collection: "lessons", id: "1" }) },
    );

    expect(res.status).toBe(200);
    expect(service.deleteCmsDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "A-Guy-educ",
      "A-Guy-Web",
      "lessons",
      "1",
    );
    await expect(res.json()).resolves.toMatchObject({ deleted: true });
  });

  it("returns cms_not_configured from the collection route", async () => {
    service.listCmsDocuments.mockImplementationOnce(async () => {
      throw new CmsConfigError(["CMS is not configured for this repo"], {
        code: "cms_not_configured",
        status: 404,
      });
    });

    const res = await collectionGET(request(), {
      params: Promise.resolve({ collection: "lessons" }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: "cms_not_configured",
      message: "CMS is not configured for this repo",
    });
  });

  it("returns cms_not_configured from the document route", async () => {
    service.getCmsDocument.mockImplementationOnce(async () => {
      throw new CmsConfigError(["CMS is not configured for this repo"], {
        code: "cms_not_configured",
        status: 404,
      });
    });

    const res = await documentGET(request(), {
      params: Promise.resolve({ collection: "lessons", id: "1" }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: "cms_not_configured",
      message: "CMS is not configured for this repo",
    });
  });

  it("lists schema-generated CMS MCP tools", async () => {
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
          adapter: "mongodb",
          mcpName: "lessons",
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
          defaultSort: [],
          fields: [
            { name: "_id", type: "id", readOnly: true },
            { name: "title", type: "text", required: true },
          ],
          filters: [],
        },
      ],
    });

    const res = await mcpPOST(
      jsonRequest("https://dash.test/api/kody/cms/mcp", "POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "cms_list_collections" },
          { name: "cms_list_lessons" },
          { name: "cms_get_lessons" },
          { name: "cms_create_lessons" },
          { name: "cms_update_lessons" },
          { name: "cms_delete_lessons" },
        ],
      },
    });
  });

  it("supports CMS MCP streamable HTTP lifecycle requests", async () => {
    const getRes = await mcpGET(request("https://dash.test/api/kody/cms/mcp"));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toContain("text/event-stream");

    const notifyRes = await mcpPOST(
      jsonRequest("https://dash.test/api/kody/cms/mcp", "POST", {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    );
    expect(notifyRes.status).toBe(202);

    const deleteRes = await mcpDELETE(
      request("https://dash.test/api/kody/cms/mcp"),
    );
    expect(deleteRes.status).toBe(202);
  });

  it("returns structured content from CMS MCP tool calls", async () => {
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
          adapter: "mongodb",
          mcpName: "lessons",
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
          defaultSort: [],
          fields: [
            { name: "_id", type: "id", readOnly: true },
            { name: "title", type: "text", required: true },
          ],
          filters: [],
        },
      ],
    });
    (
      service.listCmsDocuments as unknown as {
        mockImplementationOnce: (
          implementation: () => Promise<{
            docs: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
          }>,
        ) => void;
      }
    ).mockImplementationOnce(async () => ({
      docs: [{ _id: "1", title: "Intro" }],
      total: 1,
      limit: 10,
      offset: 0,
    }));

    const res = await mcpPOST(
      jsonRequest("https://dash.test/api/kody/cms/mcp", "POST", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "cms_list_lessons",
          arguments: { q: "intro", limit: 10 },
        },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        structuredContent: {
          docs: [{ _id: "1", title: "Intro" }],
          total: 1,
          limit: 10,
          offset: 0,
        },
        content: [{ type: "text" }],
      },
    });
    expect(service.listCmsDocuments).toHaveBeenCalledWith(
      expect.any(NextRequest),
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
});
