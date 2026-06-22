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
  getUserOctokit: vi.fn(async () => ({ __octokit: true })),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "aguy", avatar_url: "", githubId: 1 },
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
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/github-client", () => github);
vi.mock("@dashboard/lib/cms/service", () => service);
vi.mock("@dashboard/lib/state-repo", () => stateRepo);

import {
  GET as collectionGET,
  POST as collectionPOST,
} from "../app/api/kody/cms/[collection]/route";
import {
  DELETE as documentDELETE,
  GET as documentGET,
  PATCH as documentPATCH,
} from "../app/api/kody/cms/[collection]/[id]/route";
import { GET as indexGET, POST as indexPOST } from "../app/api/kody/cms/route";

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
    service.parseCmsListQuery.mockReturnValueOnce({
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
        )}&sort=title:asc,updatedAt:desc&limit=10&offset=20`,
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

  it("creates read-only CMS config files in state repo", async () => {
    service.listCmsCollections.mockResolvedValueOnce({
      configured: true,
      version: 1,
      name: "A-Guy Web CMS",
      environment: "dev",
      defaultAdapter: "mongodb",
      writePolicy: "read-only",
      collections: [],
    });

    const res = await indexPOST(
      postRequest({
        name: "A-Guy Web CMS",
        databaseUriSecret: "DATABASE_URL",
        databaseName: "A-Guy-Dev",
        collectionName: "lessons",
        collectionLabel: "Lessons",
        idField: "_id",
        titleField: "title",
        actorLogin: "aguy",
      }),
    );

    expect(res.status).toBe(201);
    expect(stateRepo.writeStateText).toHaveBeenCalledTimes(3);
    expect(stateRepo.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "cms/config.json",
        message: "chore(cms): Configure lessons",
      }),
    );
    expect(stateRepo.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({ path: "cms/environments/dev.json" }),
    );
    expect(stateRepo.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({ path: "cms/collections/lessons.json" }),
    );
    const collectionWrite = stateRepo.writeStateText.mock.calls
      .map((call) => call[0] as { path: string; content: string })
      .find((call) => call.path === "cms/collections/lessons.json");
    expect(collectionWrite).toBeTruthy();
    expect(JSON.parse(collectionWrite!.content)).toMatchObject({
      name: "lessons",
      source: { collection: "lessons", idField: "_id" },
      titleField: "title",
      operations: { create: false, update: false, delete: false },
    });
  });

  it("returns a useful setup validation message", async () => {
    const res = await indexPOST(
      postRequest({
        name: "A-Guy Web CMS",
        databaseUriSecret: "database_url",
        databaseName: "A-Guy-Dev",
        collectionName: "lessons",
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_body",
      message: "databaseUriSecret: Use an env secret name like DATABASE_URL.",
    });
    expect(stateRepo.writeStateText).not.toHaveBeenCalled();
  });

  it("trims pasted setup values before creating config", async () => {
    service.listCmsCollections.mockResolvedValueOnce({
      configured: true,
      version: 1,
      name: "A-Guy Web CMS",
      environment: "dev",
      defaultAdapter: "mongodb",
      writePolicy: "read-only",
      collections: [],
    });

    const res = await indexPOST(
      postRequest({
        name: " A-Guy Web CMS ",
        databaseUriSecret: " DATABASE_URL ",
        databaseName: " A-Guy-Dev ",
        collectionName: " lessons ",
        collectionLabel: " Lessons ",
        idField: " _id ",
        titleField: " title ",
        actorLogin: " stale-login ",
      }),
    );

    expect(res.status).toBe(201);
    const environmentWrite = stateRepo.writeStateText.mock.calls
      .map((call) => call[0] as { path: string; content: string })
      .find((call) => call.path === "cms/environments/dev.json");
    expect(environmentWrite).toBeTruthy();
    expect(JSON.parse(environmentWrite!.content)).toMatchObject({
      databaseUriSecret: "DATABASE_URL",
      databaseName: "A-Guy-Dev",
    });
  });

  it("omits databaseName when setup should use database from URI", async () => {
    service.listCmsCollections.mockResolvedValueOnce({
      configured: true,
      version: 1,
      name: "A-Guy Web CMS",
      environment: "dev",
      defaultAdapter: "mongodb",
      writePolicy: "read-only",
      collections: [],
    });

    const res = await indexPOST(
      postRequest({
        name: "A-Guy Web CMS",
        databaseUriSecret: "DATABASE_URL",
        databaseName: " ",
        collectionName: "lessons",
      }),
    );

    expect(res.status).toBe(201);
    const environmentWrite = stateRepo.writeStateText.mock.calls
      .map((call) => call[0] as { path: string; content: string })
      .find((call) => call.path === "cms/environments/dev.json");
    expect(environmentWrite).toBeTruthy();
    expect(JSON.parse(environmentWrite!.content)).toMatchObject({
      databaseUriSecret: "DATABASE_URL",
    });
    expect(JSON.parse(environmentWrite!.content)).not.toHaveProperty(
      "databaseName",
    );
  });

  it("does not overwrite an existing CMS config", async () => {
    stateRepo.readStateText.mockResolvedValueOnce({
      path: "A-Guy-Web/cms/config.json",
      sha: "sha",
      content: "{}",
    });

    const res = await indexPOST(
      postRequest({
        name: "A-Guy Web CMS",
        databaseUriSecret: "DATABASE_URL",
        databaseName: "A-Guy-Dev",
        collectionName: "lessons",
      }),
    );

    expect(res.status).toBe(409);
    expect(stateRepo.writeStateText).not.toHaveBeenCalled();
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
});
