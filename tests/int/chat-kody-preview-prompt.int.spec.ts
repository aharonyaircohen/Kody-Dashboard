/**
 * @fileoverview Route-level regression test for preview-context issue creation.
 * @testFramework vitest
 * @domain chat-contract
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { RENDER_VIEW_DIRECTIVE } from "@dashboard/lib/chat-ui-actions";
import {
  FINAL_ANSWER_REQUIRES_VIEW_ERROR,
  FINAL_ANSWER_TOOL,
  SHOW_VIEW_TOOL,
} from "@dashboard/lib/chat-output-tools";

const streamTextMock = vi.hoisted(() => vi.fn());
const createUIMessageStreamResponseMock = vi.hoisted(() => vi.fn());
const loadViewRendererContextForPromptMock = vi.hoisted(() => vi.fn());
const resolveBestViewRendererDefinitionMock = vi.hoisted(() => vi.fn());
const loadInstructionsForPromptMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  tool: (definition: unknown) => definition,
  jsonSchema: (schema: unknown, options?: unknown) => ({
    jsonSchema: schema,
    ...(options && typeof options === "object" ? options : {}),
  }),
  streamText: streamTextMock,
  stepCountIs: vi.fn(() => vi.fn()),
  createUIMessageStream: vi.fn((config: unknown) => config),
  createUIMessageStreamResponse: createUIMessageStreamResponseMock,
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "app",
    storeRepoUrl: undefined,
    storeRef: undefined,
  })),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "alice" } })),
  getUserOctokit: vi.fn(async () => ({})),
}));

vi.mock("@dashboard/lib/github-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@dashboard/lib/github-client")>();
  return {
    ...actual,
    createUserOctokit: vi.fn(() => ({})),
    setGitHubContext: vi.fn(),
    clearGitHubContext: vi.fn(),
  };
});

vi.mock("@dashboard/lib/memory-files", () => ({
  invalidateMemoryIndexPromptCache: vi.fn(),
  loadMemoryIndexForPrompt: vi.fn(async () => null),
  readMemoryFile: vi.fn(async () => null),
  writeMemoryFile: vi.fn(),
}));

vi.mock("@dashboard/lib/instructions/files", () => ({
  loadInstructionsForPrompt: loadInstructionsForPromptMock,
}));

vi.mock("@dashboard/lib/context/files", () => ({
  loadContextForPrompt: vi.fn(async () => null),
}));

vi.mock("@dashboard/lib/view-renderers/renderers", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@dashboard/lib/view-renderers/renderers")
    >();
  return {
    ...actual,
    loadViewRendererContextForPrompt: loadViewRendererContextForPromptMock,
    resolveBestViewRendererDefinition: resolveBestViewRendererDefinitionMock,
  };
});

vi.mock("../../app/api/kody/chat/resolve-model", () => ({
  resolveChatModel: vi.fn(async () => ({
    model: { modelId: "test-model" },
    apiKey: "test-key",
    resolvedModel: {
      id: "test-model",
      label: "Test model",
      provider: "openai",
      protocol: "openai-compatible",
      baseURL: "https://models.test/v1",
      modelName: "test-model",
      apiKeySecret: "TEST_MODEL_API_KEY",
      enabled: true,
      default: true,
    },
  })),
}));

vi.mock("../../app/api/kody/chat/tools/cms-tools", () => ({
  createCmsTools: vi.fn(async () => ({})),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "app",
    },
    body: JSON.stringify(body),
  });
}

const approvalRendererDefinition = {
  slug: "approval-card",
  name: "Approval Card",
  purpose: "approval-card",
  rule: "Use this purpose when Kody asks the user for approval.",
  data: {
    title: { type: "text", description: "Short approval question." },
    body: { type: "text", optional: true },
    actions: { type: "actions", optional: true },
  },
  defaults: {
    actions: [
      {
        id: "approve",
        label: "Approve",
        response: "approve",
        variant: "primary",
      },
      { id: "cancel", label: "Cancel", response: "cancel" },
    ],
  },
  type: "layout",
  ui: {
    type: "stack",
    children: [
      { type: "text", value: "$title", variant: "title" },
      { type: "text", value: "$body" },
      {
        type: "row",
        for: "$actions",
        as: "action",
        item: { type: "button", label: "$action.label", action: "$action" },
      },
    ],
  },
} as const;

describe("POST /api/kody/chat/kody preview prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KODY_MASTER_KEY = "kody-direct-test-secret";
    loadViewRendererContextForPromptMock.mockResolvedValue({
      rules:
        "- Purpose `approval-card`: Use this purpose when Kody asks the user for approval.\n" +
        "  Data keys:\n" +
        "  - title (text): Short approval question.\n" +
        "  - body (text, optional)\n" +
        "  - actions (actions, default available, optional)",
      definitions: [approvalRendererDefinition],
    });
    resolveBestViewRendererDefinitionMock.mockResolvedValue({
      definition: approvalRendererDefinition,
      source: "repo",
      sha: "approval-fixture",
      htmlUrl:
        "https://github.test/acme/app/views/renderers/approval-card.json",
    });
    streamTextMock.mockReturnValue({
      toUIMessageStream: vi.fn(() => ({})),
    });
    loadInstructionsForPromptMock.mockResolvedValue(null);
    createUIMessageStreamResponseMock.mockReturnValue(
      new Response("ok", { status: 200 }),
    );
  });

  it("sends preview make-page instructions in the actual model system prompt", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "make this page" }],
        previewContext:
          "[Preview context]\n- Source path: views/demo-123\n- Preview URL: /api/kody/views/demo-123/index.html",
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const system = streamTextMock.mock.calls[0]?.[0]?.system;
    expect(system).toContain("## Current preview reference");
    expect(system).toContain('"make this page"');
    expect(system).toContain("create a GitHub issue");
    expect(system).toContain("Do not answer with a fresh design direction");
    expect(system).toContain("Source path: views/demo-123");
  });

  it("keeps repo PM-style instructions after the generic safety reminders", async () => {
    loadInstructionsForPromptMock.mockResolvedValue(
      "write short not technical answers, operator is a PM",
    );
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "what is wrong here?" }],
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const system = streamTextMock.mock.calls[0]?.[0]?.system;
    expect(system).toContain("## Critical reminders");
    expect(system).toContain("## User instructions for this repo");
    expect(system.indexOf("## Critical reminders")).toBeLessThan(
      system.indexOf("## User instructions for this repo"),
    );
    expect(system).toContain(
      "write short not technical answers, operator is a PM",
    );
    expect(system).toContain(
      "For a PM, founder, or non-technical operator, lead with the business or product effect",
    );
  });

  it("exposes a working show_view contract for approval renderer requests", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "aske me a q and ask for approval to confirm it",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const options = streamTextMock.mock.calls[0]?.[0];
    const showView = options?.tools?.show_view as
      | {
          description?: string;
          inputSchema?: {
            jsonSchema?: {
              oneOf?: Array<{
                properties?: {
                  purpose?: { enum?: string[] };
                  data?: {
                    required?: string[];
                    properties?: Record<string, unknown>;
                  };
                };
              }>;
            };
          };
          execute?: (input: Record<string, unknown>) => Promise<unknown>;
        }
      | undefined;

    expect(showView?.description).toContain("Available renderer rules");
    const approvalVariant = showView?.inputSchema?.jsonSchema?.oneOf?.find(
      (variant) => variant.properties?.purpose?.enum?.[0] === "approval-card",
    );
    expect(approvalVariant?.properties?.data).toMatchObject({
      required: ["title"],
      properties: {
        title: expect.objectContaining({ type: "string" }),
      },
    });
    expect(showView?.execute).toBeTypeOf("function");

    const output = await showView?.execute?.({
      purpose: "approval-card",
      data: {
        title: "Confirm this question?",
        body: "Should I continue?",
      },
    });

    expect(output).toMatchObject({
      action: RENDER_VIEW_DIRECTIVE,
      view: "renderer",
      rendererSlug: "approval-card",
      data: {
        title: "Confirm this question?",
        body: "Should I continue?",
      },
    });
    expect(resolveBestViewRendererDefinitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "approval-card",
        data: {
          title: "Confirm this question?",
          body: "Should I continue?",
        },
      }),
    );
  });

  it("repairs an empty show_view tool call using renderer definitions", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "aske me a q and ask for approval to confirm it",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const repairToolCall = streamTextMock.mock.calls[0]?.[0]
      ?.experimental_repairToolCall as
      | ((input: {
          toolCall: {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: string;
          };
        }) => Promise<{ input: string } | null>)
      | undefined;

    expect(repairToolCall).toBeTypeOf("function");
    const repaired = await repairToolCall?.({
      toolCall: {
        type: "tool-call",
        toolCallId: "empty-show-view",
        toolName: "show_view",
        input: "{}",
      },
    });

    expect(repaired).toMatchObject({
      toolName: "show_view",
    });
    expect(JSON.parse(repaired?.input ?? "{}")).toMatchObject({
      purpose: "approval-card",
      data: {
        title: expect.stringContaining("approval"),
      },
    });
  });

  it("forces show_view after a plain final answer asks for a user choice", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "look into this bug",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const options = streamTextMock.mock.calls[0]?.[0];
    const prepareStep = options?.prepareStep as
      | ((input: {
          steps: Array<{
            toolResults: Array<{
              toolName: string;
              output: unknown;
            }>;
          }>;
        }) => {
          activeTools?: string[];
          toolChoice?: "required";
        })
      | undefined;

    expect(prepareStep).toBeTypeOf("function");
    expect(
      prepareStep?.({
        steps: [
          {
            toolResults: [
              {
                toolName: FINAL_ANSWER_TOOL,
                output: { error: FINAL_ANSWER_REQUIRES_VIEW_ERROR },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      activeTools: [SHOW_VIEW_TOOL],
      toolChoice: "required",
    });
  });
});
