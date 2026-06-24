import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { getCmsActorRole } from "@dashboard/lib/cms/roles";
import {
  CmsRuntimeError,
  createCmsDocument,
  deleteCmsDocument,
  getCmsDocument,
  listCmsCollections,
  listCmsDocuments,
  updateCmsDocument,
} from "@dashboard/lib/cms/service";
import { CmsConfigError } from "@dashboard/lib/cms/config";
import { generateCmsMcpTools, resolveCmsMcpTool } from "@dashboard/lib/cms/mcp";
import type {
  CmsConfigState,
  CmsDocument,
  CmsListQuery,
  CmsSortEntry,
} from "@dashboard/lib/cms/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

interface JsonRpcRequest {
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  return new NextResponse(": kody-cms-mcp\n\n", {
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    },
  });
}

export async function DELETE(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  return new NextResponse(null, { status: 202, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );

  let body: JsonRpcRequest | null = null;

  try {
    body = (await req.json().catch(() => null)) as JsonRpcRequest | null;
    if (!body || typeof body !== "object") {
      return jsonRpcError(null, -32700, "Parse error");
    }

    if (!("id" in body)) {
      return new NextResponse(null, { status: 202, headers: NO_STORE_HEADERS });
    }

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const actorRole = await getCmsActorRole(
      req,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const cms = await listCmsCollections(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      actorRole,
    );

    if (body.method === "initialize") {
      return jsonRpcResult(body.id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "kody-cms", version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }

    if (body.method === "ping") {
      return jsonRpcResult(body.id, {});
    }

    if (body.method === "notifications/initialized") {
      return new NextResponse(null, { status: 202, headers: NO_STORE_HEADERS });
    }

    if (body.method === "tools/list") {
      if (cms.configured === false)
        return jsonRpcResult(body.id, { tools: [] });
      return jsonRpcResult(body.id, { tools: generateCmsMcpTools(cms) });
    }

    if (body.method === "tools/call") {
      if (cms.configured === false) {
        return jsonRpcError(body.id, -32004, "CMS is not configured.");
      }
      const result = await callCmsTool(req, cms, body.params, {
        octokit,
        owner: headerAuth.owner,
        repo: headerAuth.repo,
      });
      return jsonRpcResult(body.id, {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      });
    }

    return jsonRpcError(body.id, -32601, "Method not found");
  } catch (error) {
    return handleMcpError(error, body?.id ?? null);
  } finally {
    clearGitHubContext();
  }
}

async function callCmsTool(
  req: NextRequest,
  cms: Extract<CmsConfigState, { configured: true }>,
  params: unknown,
  context: {
    octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>;
    owner: string;
    repo: string;
  },
): Promise<unknown> {
  const payload = params && typeof params === "object" ? params : {};
  const name = stringValue((payload as Record<string, unknown>).name);
  if (!name) throw new CmsConfigError(["tools/call requires tool name"]);
  const ref = resolveCmsMcpTool(cms, name);
  if (!ref) throw new CmsConfigError([`unknown CMS MCP tool: ${name}`]);

  const args =
    (payload as Record<string, unknown>).arguments &&
    typeof (payload as Record<string, unknown>).arguments === "object"
      ? ((payload as Record<string, unknown>).arguments as Record<
          string,
          unknown
        >)
      : {};

  if (name === "cms_list_collections") {
    return {
      collections: cms.collections.map((collection) => ({
        name: collection.name,
        label: collection.label,
        operations: collection.operations,
      })),
    };
  }

  if (ref.action === "list") {
    return listCmsDocuments(
      req,
      context.octokit,
      context.owner,
      context.repo,
      ref.collection,
      {
        filters: filtersValue(args.filters),
        search:
          typeof args.q === "string" && args.q.trim()
            ? { query: args.q.trim() }
            : undefined,
        sort: sortValue(args.sort),
        limit: numberValue(args.limit),
        offset: numberValue(args.offset),
      },
    );
  }

  if (ref.action === "get") {
    return {
      document: await getCmsDocument(
        req,
        context.octokit,
        context.owner,
        context.repo,
        ref.collection,
        requiredString(args.id, "id"),
      ),
    };
  }

  if (ref.action === "create") {
    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) {
      throw new CmsRuntimeError(
        "actor_mismatch",
        "Actor does not match token owner.",
        403,
      );
    }
    return {
      document: await createCmsDocument(
        req,
        context.octokit,
        context.owner,
        context.repo,
        ref.collection,
        documentValue(args.data),
      ),
    };
  }

  if (ref.action === "update") {
    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) {
      throw new CmsRuntimeError(
        "actor_mismatch",
        "Actor does not match token owner.",
        403,
      );
    }
    return {
      document: await updateCmsDocument(
        req,
        context.octokit,
        context.owner,
        context.repo,
        ref.collection,
        requiredString(args.id, "id"),
        documentValue(args.data),
      ),
    };
  }

  const actorResult = await verifyActorLogin(req, undefined);
  if (actorResult instanceof NextResponse) {
    throw new CmsRuntimeError(
      "actor_mismatch",
      "Actor does not match token owner.",
      403,
    );
  }
  return {
    deleted: await deleteCmsDocument(
      req,
      context.octokit,
      context.owner,
      context.repo,
      ref.collection,
      requiredString(args.id, "id"),
    ),
  };
}

function jsonRpcResult(
  id: JsonRpcRequest["id"],
  result: unknown,
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, result },
    { headers: NO_STORE_HEADERS },
  );
}

function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { headers: NO_STORE_HEADERS },
  );
}

function handleMcpError(
  error: unknown,
  id: JsonRpcRequest["id"],
): NextResponse {
  if (error instanceof CmsConfigError || error instanceof CmsRuntimeError) {
    return jsonRpcError(id, -32000, error.message);
  }
  logger.error({ err: error }, "cms mcp failed");
  return jsonRpcError(id, -32603, "Internal error");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string): string {
  const result = stringValue(value);
  if (!result) throw new CmsConfigError([`${field} is required`]);
  return result;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function filtersValue(value: unknown): CmsListQuery["filters"] {
  return objectValue(value) as CmsListQuery["filters"];
}

function documentValue(value: unknown): CmsDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CmsConfigError(["data must be an object"]);
  }
  return value as CmsDocument;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sortValue(value: unknown): CmsSortEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const field = stringValue((entry as Record<string, unknown>).field);
    if (!field) return [];
    return [
      {
        field,
        direction:
          (entry as Record<string, unknown>).direction === "asc"
            ? "asc"
            : "desc",
      } satisfies CmsSortEntry,
    ];
  });
}
