/**
 * @fileoverview Integration tests for server-side surface scoping
 *   (phase 2 step 6) across the three chat backends.
 * @testFramework vitest
 * @domain chat-platform
 *
 * Covers: the kody in-process route accepts a surface ticket in place of a
 * PAT and serves a RESTRICTED tool set (strict subset of the admin set —
 * no repo/admin tools ever reach the model); the trigger and brain routes
 * reject ticket-only requests with 403; and unauthenticated requests still
 * 401 exactly as before (admin behavior unchanged — existing int specs
 * assert the full admin path byte-for-byte).
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const resolveChatModelMock = vi.hoisted(() => vi.fn());
vi.mock("../../app/api/kody/chat/resolve-model", () => ({
  resolveChatModel: resolveChatModelMock,
}));

import { POST as kodyChatPOST } from "../../app/api/kody/chat/kody/route";
import { POST as triggerPOST } from "../../app/api/kody/chat/trigger/route";
import { POST as brainPOST } from "../../app/api/kody/chat/brain/route";
import {
  CLIENT_SURFACE_TOOL_ALLOWLIST,
  mintClientSurfaceTicket,
  SURFACE_TICKET_HEADER,
} from "@dashboard/lib/chat/platform/surface-scope";
import {
  CHAT_OUTPUT_TOOL_NAMES,
  FINAL_ANSWER_TOOL,
} from "@dashboard/lib/chat-output-tools";

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "surface-scope-int-test-secret";
});

function ticketHeaders(): Record<string, string> {
  const { ticket } = mintClientSurfaceTicket({
    brandSlug: "acme",
    owner: "acme-co",
    repo: "widgets",
  });
  return { [SURFACE_TICKET_HEADER]: ticket };
}

function makeRequest(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): NextRequest {
  return new NextRequest(`https://dash.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const chatBody = { messages: [{ role: "user", content: "hi" }] };

function mockModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: FINAL_ANSWER_TOOL,
            input: JSON.stringify({ content: "hello" }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  });
}

describe("surface scoping — kody in-process route", () => {
  it("accepts a ticket-only request and restricts the tool set", async () => {
    const model = mockModel();
    resolveChatModelMock.mockResolvedValue({
      model,
      resolvedModel: { id: "mock/model", modelName: "mock-model" },
    });

    const res = await kodyChatPOST(
      makeRequest("/api/kody/chat/kody", chatBody, ticketHeaders()),
    );
    expect(res.status).toBe(200);
    // Drain the stream so onFinish/cleanup runs.
    await res.text();

    const sentTools = (model.doStreamCalls[0]?.tools ?? []).map((t) => t.name);
    expect(sentTools.length).toBeGreaterThan(0);
    // Every tool the model saw is either chat protocol or in the allowlist.
    const allowed = new Set<string>([
      ...CLIENT_SURFACE_TOOL_ALLOWLIST,
      ...CHAT_OUTPUT_TOOL_NAMES,
    ]);
    for (const name of sentTools) {
      expect(allowed.has(name), `unexpected surface tool: ${name}`).toBe(true);
    }
    // Strict subset of the admin set: admin-only tools must be absent.
    for (const forbidden of [
      "create_task",
      "get_secret",
      "set_secret",
      "switch_agent",
      "kody_run_issue",
      "list_workflow_runs",
    ]) {
      expect(sentTools).not.toContain(forbidden);
    }
  });

  it("still 401s with neither PAT nor ticket (unchanged)", async () => {
    const res = await kodyChatPOST(
      makeRequest("/api/kody/chat/kody", chatBody, {}),
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(String(data.message)).toContain("x-kody-token");
  });

  it("401s on an invalid ticket (falls through to today's auth)", async () => {
    const res = await kodyChatPOST(
      makeRequest("/api/kody/chat/kody", chatBody, {
        [SURFACE_TICKET_HEADER]: "garbage",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("surface scoping — admin-only backends reject tickets", () => {
  it("trigger: 403 surface_scope_forbidden on a ticket-only request", async () => {
    const res = await triggerPOST(
      makeRequest("/api/kody/chat/trigger", chatBody, ticketHeaders()),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("surface_scope_forbidden");
  });

  it("trigger: still 401 with no credentials at all (unchanged)", async () => {
    const res = await triggerPOST(
      makeRequest("/api/kody/chat/trigger", chatBody, {}),
    );
    expect(res.status).toBe(401);
  });

  it("brain: 403 surface_scope_forbidden on a ticket-only request", async () => {
    const res = await brainPOST(
      makeRequest("/api/kody/chat/brain", chatBody, ticketHeaders()),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("surface_scope_forbidden");
  });

  it("brain: still 401 with no credentials at all (unchanged)", async () => {
    const res = await brainPOST(
      makeRequest("/api/kody/chat/brain", chatBody, {}),
    );
    expect(res.status).toBe(401);
  });
});
