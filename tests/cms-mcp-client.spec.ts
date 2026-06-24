import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { createMCPClient } from "@ai-sdk/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    }),
  ),
  listCmsDocuments: vi.fn(async () => ({
    docs: [{ _id: "1", title: "Intro" }],
    total: 1,
    limit: 10,
    offset: 0,
  })),
  getCmsDocument: vi.fn(async () => ({ _id: "1", title: "Intro" })),
  createCmsDocument: vi.fn(async () => ({ _id: "new-id", title: "Created" })),
  updateCmsDocument: vi.fn(async () => ({ _id: "1", title: "Updated" })),
  deleteCmsDocument: vi.fn(async () => true),
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

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/github-client", () => github);
vi.mock("@dashboard/lib/cms/service", () => service);

import { DELETE, GET, POST } from "../app/api/kody/cms/mcp/route";

describe("CMS MCP HTTP compatibility", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connects with the installed MCP HTTP client and calls generated tools", async () => {
    const server = createServer(handleMcpRequest);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: `http://127.0.0.1:${port}/api/kody/cms/mcp`,
        headers: {
          "x-kody-token": "ghp_test",
          "x-kody-owner": "A-Guy-educ",
          "x-kody-repo": "A-Guy-Web",
        },
      },
    });

    try {
      const tools = await client.tools();
      expect(Object.keys(tools)).toEqual([
        "cms_list_collections",
        "cms_list_lessons",
        "cms_get_lessons",
        "cms_create_lessons",
        "cms_update_lessons",
        "cms_delete_lessons",
      ]);

      const result = await tools.cms_list_lessons.execute?.(
        { q: "intro", limit: 10 },
        { toolCallId: "call-1", messages: [] },
      );
      expect(result).toMatchObject({
        structuredContent: {
          docs: [{ _id: "1", title: "Intro" }],
        },
      });
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const request = new NextRequest(
    `http://127.0.0.1${req.url ?? "/api/kody/cms/mcp"}`,
    {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: body.length > 0 ? body.toString("utf8") : undefined,
    },
  );
  const response =
    req.method === "GET"
      ? await GET(request)
      : req.method === "DELETE"
        ? await DELETE(request)
        : await POST(request);
  res.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  );
  const responseBody = Buffer.from(await response.arrayBuffer());
  res.end(responseBody);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
