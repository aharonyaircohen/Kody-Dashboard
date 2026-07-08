/**
 * @fileType api-endpoint
 * @domain chat-platform
 * @pattern mcp-over-http
 *
 * /api/kody/chat/plugin-tools/mcp — MCP-over-HTTP endpoint exposing the chat
 * plugin server-tool registry to the engine (`kody-live`) backend. Phase 2
 * Step 1 of the chat platform plan; protocol handling mirrors the in-repo
 * precedent at app/api/kody/cms/mcp/route.ts (Streamable HTTP basics:
 * initialize / ping / tools/list / tools/call / initialized notification /
 * SSE GET / session-close DELETE).
 *
 * Auth: a repo-scoped bearer credential (`owner/repo:hmac`) minted with the
 * purpose-prefixed KODY_MASTER_KEY HMAC (`kody-plugin-tools:` — see
 * plugin-tools-config.ts). Accepted as `Authorization: Bearer …` or a
 * `?token=` query param (for clients that cannot set headers). Tool calls
 * execute with a server context built from the VERIFIED scope plus the
 * server-side GITHUB_TOKEN used by other unattended (cron/webhook) routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@dashboard/lib/logger";
import {
  verifyPluginToolsBearer,
  type PluginToolsScope,
} from "@dashboard/lib/chat/platform/plugin-tools-config";
import { getChatServerToolRegistry } from "@dashboard/lib/chat/platform/server-tools";
import {
  ChatToolRegistrationError,
  type ChatToolServerContext,
} from "@dashboard/lib/chat/platform/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

interface JsonRpcRequest {
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function scopeFrom(req: NextRequest): PluginToolsScope | null {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice("bearer ".length).trim()
    : (req.nextUrl.searchParams.get("token") ?? "");
  if (!bearer) return null;
  try {
    return verifyPluginToolsBearer(bearer);
  } catch {
    // KODY_MASTER_KEY missing — treat as unauthenticated, never 500.
    return null;
  }
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "invalid_token" },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: NextRequest) {
  if (!scopeFrom(req)) return unauthorized();
  return new NextResponse(": kody-plugin-tools-mcp\n\n", {
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    },
  });
}

export async function DELETE(req: NextRequest) {
  if (!scopeFrom(req)) return unauthorized();
  return new NextResponse(null, { status: 202, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const scope = scopeFrom(req);
  if (!scope) return unauthorized();

  let body: JsonRpcRequest | null = null;
  try {
    body = (await req.json().catch(() => null)) as JsonRpcRequest | null;
    if (!body || typeof body !== "object") {
      return jsonRpcError(null, -32700, "Parse error");
    }

    // Notifications (no id) get a bare 202, per Streamable HTTP.
    if (!("id" in body)) {
      return new NextResponse(null, { status: 202, headers: NO_STORE_HEADERS });
    }

    if (body.method === "initialize") {
      return jsonRpcResult(body.id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "kody-plugin-tools", version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }

    if (body.method === "ping") {
      return jsonRpcResult(body.id, {});
    }

    if (body.method === "notifications/initialized") {
      return new NextResponse(null, { status: 202, headers: NO_STORE_HEADERS });
    }

    const ctx = serverContext(scope);

    if (body.method === "tools/list") {
      const tools = Object.entries(
        getChatServerToolRegistry().collect(ctx),
      ).map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: toInputJsonSchema(def.inputSchema),
      }));
      return jsonRpcResult(body.id, { tools });
    }

    if (body.method === "tools/call") {
      return await callPluginTool(body.id, body.params, ctx);
    }

    return jsonRpcError(body.id, -32601, "Method not found");
  } catch (error) {
    return handleMcpError(error, body?.id ?? null);
  }
}

/**
 * Server context for tool execution. `token` is the server-side GitHub token
 * (the same GITHUB_TOKEN unattended cron/webhook flows run on — see
 * CLAUDE.md env table); scope comes from the verified bearer, never from
 * request params.
 */
function serverContext(scope: PluginToolsScope): ChatToolServerContext {
  return {
    owner: scope.owner,
    repo: scope.repo,
    token: process.env.GITHUB_TOKEN ?? "",
  };
}

async function callPluginTool(
  id: JsonRpcRequest["id"],
  params: unknown,
  ctx: ChatToolServerContext,
): Promise<NextResponse> {
  const payload = (
    params && typeof params === "object" ? params : {}
  ) as Record<string, unknown>;
  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : null;
  if (!name) return jsonRpcError(id, -32602, "tools/call requires tool name");

  const args =
    payload.arguments && typeof payload.arguments === "object"
      ? payload.arguments
      : {};

  const tool = getChatServerToolRegistry().collect(ctx)[name];
  if (!tool) {
    return jsonRpcError(id, -32000, `unknown plugin tool: ${name}`);
  }

  try {
    // The registry wrapper zod-parses input before the handler runs.
    const result = await tool.execute(args, ctx);
    return jsonRpcResult(id, {
      structuredContent: result,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonRpcError(id, -32602, `invalid arguments: ${error.message}`);
    }
    throw error;
  }
}

/** MCP wants JSON Schema; tools declare zod (v4 has a native converter). */
function toInputJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  } catch {
    // Unrepresentable schema (custom refinements, etc.) — advertise an open
    // object; the execute wrapper still enforces the real zod schema.
    return { type: "object" };
  }
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
  if (error instanceof ChatToolRegistrationError) {
    return jsonRpcError(id, -32000, error.message);
  }
  logger.error({ err: error }, "plugin-tools mcp failed");
  return jsonRpcError(id, -32603, "Internal error");
}
