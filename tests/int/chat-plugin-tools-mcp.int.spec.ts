/**
 * @fileoverview Integration tests for /api/kody/chat/plugin-tools/mcp —
 *   the MCP-over-HTTP bridge exposing chat plugin server tools to the
 *   engine backend (phase 2 step 1).
 * @testFramework vitest
 * @domain chat-platform
 *
 * Drives the real route handler with a fixture plugin registered in the
 * (module-singleton) server tool registry: initialize handshake, tools/list
 * with a zod→JSON-schema conversion, tools/call happy path (verified scope +
 * server GITHUB_TOKEN in ctx), zod rejection (-32602), unknown tool, and
 * 401s for missing/tampered bearers. The empty-registry assertions run
 * BEFORE the fixture registration (singleton — order matters).
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

import {
  GET as mcpGET,
  POST as mcpPOST,
} from "../../app/api/kody/chat/plugin-tools/mcp/route";
import { buildPluginToolsBearer } from "@dashboard/lib/chat/platform/plugin-tools-config";
import { getChatServerToolRegistry } from "@dashboard/lib/chat/platform/server-tools";
import type { ChatToolServerContext } from "@dashboard/lib/chat/platform/tools";

const URL_BASE = "https://dash.test/api/kody/chat/plugin-tools/mcp";

function rpc(
  body: unknown,
  bearer?: string,
  query = "",
): NextRequest {
  return new NextRequest(`${URL_BASE}${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

let bearer: string;
const executeSpy = vi.fn(
  async (input: unknown, ctx: ChatToolServerContext) => ({
    echoed: input,
    scope: `${ctx.owner}/${ctx.repo}`,
    hasToken: ctx.token.length > 0,
  }),
);

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "test-secret-for-plugin-tools-hmac";
  process.env.GITHUB_TOKEN = "ghp_server-side-token";
  bearer = buildPluginToolsBearer("acme", "widgets");
});

describe("plugin-tools MCP route", () => {
  it("401s without a bearer, with a tampered bearer, and on GET", async () => {
    expect((await mcpPOST(rpc({ id: 1, method: "ping" }))).status).toBe(401);
    expect(
      (await mcpPOST(rpc({ id: 1, method: "ping" }, `${bearer}0`))).status,
    ).toBe(401);
    expect(
      (
        await mcpGET(
          new NextRequest(URL_BASE, { method: "GET" }),
        )
      ).status,
    ).toBe(401);
  });

  it("lists zero tools while no plugin has registered (fail-open surface)", async () => {
    const res = await mcpPOST(rpc({ id: 1, method: "tools/list" }, bearer));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toEqual({ tools: [] });
  });

  it("handles the MCP handshake (initialize / ping / initialized / GET SSE)", async () => {
    const init = await mcpPOST(rpc({ id: 1, method: "initialize" }, bearer));
    const initBody = await init.json();
    expect(initBody.result.serverInfo.name).toBe("kody-plugin-tools");
    expect(initBody.result.capabilities).toEqual({ tools: {} });

    const ping = await mcpPOST(rpc({ id: 2, method: "ping" }, bearer));
    expect((await ping.json()).result).toEqual({});

    const notif = await mcpPOST(
      rpc({ method: "notifications/initialized" }, bearer),
    );
    expect(notif.status).toBe(202);

    const sse = await mcpGET(
      new NextRequest(`${URL_BASE}?token=${encodeURIComponent(bearer)}`, {
        method: "GET",
      }),
    );
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toBe("text/event-stream");
  });

  it("lists and calls a fixture plugin tool with the verified scope in ctx", async () => {
    getChatServerToolRegistry().register("mcp-int-fixture", () => ({
      fixture_echo: {
        description: "Echo the payload back",
        inputSchema: z.object({ text: z.string().min(1) }),
        execute: executeSpy,
      },
    }));

    const list = await mcpPOST(rpc({ id: 3, method: "tools/list" }, bearer));
    const { tools } = (await list.json()).result;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("fixture_echo");
    expect(tools[0].description).toBe("Echo the payload back");
    expect(tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    });

    const call = await mcpPOST(
      rpc(
        {
          id: 4,
          method: "tools/call",
          params: { name: "fixture_echo", arguments: { text: "hi" } },
        },
        bearer,
      ),
    );
    const result = (await call.json()).result;
    expect(result.structuredContent).toEqual({
      echoed: { text: "hi" },
      scope: "acme/widgets",
      hasToken: true,
    });
    expect(result.content[0].type).toBe("text");
    // ctx.token is the server-side GITHUB_TOKEN, never the bearer.
    expect(executeSpy.mock.calls[0][1].token).toBe("ghp_server-side-token");
  });

  it("rejects zod-invalid arguments with -32602 and unknown tools with -32000", async () => {
    const bad = await mcpPOST(
      rpc(
        {
          id: 5,
          method: "tools/call",
          params: { name: "fixture_echo", arguments: { text: 42 } },
        },
        bearer,
      ),
    );
    const badBody = await bad.json();
    expect(badBody.error.code).toBe(-32602);
    expect(badBody.error.message).toMatch(/invalid arguments/);

    const unknown = await mcpPOST(
      rpc({ id: 6, method: "tools/call", params: { name: "nope" } }, bearer),
    );
    expect((await unknown.json()).error.code).toBe(-32000);

    const noMethod = await mcpPOST(rpc({ id: 7, method: "wat" }, bearer));
    expect((await noMethod.json()).error.code).toBe(-32601);
  });
});
