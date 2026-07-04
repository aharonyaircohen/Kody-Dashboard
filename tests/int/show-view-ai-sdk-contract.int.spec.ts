/**
 * @fileoverview AI SDK contract test for renderer tool calls.
 * @testFramework vitest
 * @domain chat-renderers
 */

import { describe, expect, it, vi } from "vitest";
import { simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { RENDER_VIEW_DIRECTIVE } from "@dashboard/lib/chat-ui-actions";
import { createUiTools } from "../../app/api/kody/chat/tools/ui-tools";
import type { ViewRendererDefinition } from "@dashboard/lib/view-renderers/renderers";
import { repairShowViewToolCall } from "@dashboard/lib/view-renderers/chat-contract";

const resolveBestViewRendererDefinitionMock = vi.hoisted(() => vi.fn());

vi.mock("@dashboard/lib/view-renderers/renderers", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@dashboard/lib/view-renderers/renderers")
    >();
  return {
    ...actual,
    resolveBestViewRendererDefinition: resolveBestViewRendererDefinitionMock,
  };
});

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 1,
    text: 0,
    reasoning: 0,
  },
};

const approvalRendererDefinition: ViewRendererDefinition = {
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
};

describe("show_view AI SDK contract", () => {
  it("accepts model-emitted approval data and returns a rendered view result", async () => {
    resolveBestViewRendererDefinitionMock.mockResolvedValue({
      definition: approvalRendererDefinition,
      source: "repo",
      sha: "approval-fixture",
      htmlUrl:
        "https://github.test/acme/app/views/renderers/approval-card.json",
    });

    const model = new MockLanguageModelV3({
      modelId: "renderer-contract-model",
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-approval",
              toolName: "show_view",
              input: JSON.stringify({
                purpose: "approval-card",
                data: {
                  title: "Confirm this question?",
                  body: "Should I continue?",
                },
              }),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage,
            },
          ],
        }),
      }),
    });
    const tools = createUiTools({
      viewRendererDefinitions: [approvalRendererDefinition],
      viewRendererRules:
        "- Purpose `approval-card`: Use this purpose when Kody asks the user for approval.\n" +
        "  Data keys:\n" +
        "  - title (text): Short approval question.\n" +
        "  - body (text, optional)\n" +
        "  - actions (actions, default available, optional)",
    });

    const result = streamText({
      model,
      messages: [
        {
          role: "user",
          content: "aske me a q and ask for approval to confirm it",
        },
      ],
      tools: {
        show_view: tools.show_view,
      },
      toolChoice: { type: "tool", toolName: "show_view" },
      stopWhen: ({ steps }) => steps.length > 0,
    });

    const toolResults = await result.toolResults;
    const showViewTool = model.doStreamCalls[0]?.tools?.find(
      (candidate) => candidate.name === "show_view",
    ) as
      | {
          inputSchema?: {
            oneOf?: Array<{
              properties?: {
                purpose?: { enum?: string[] };
                data?: {
                  required?: string[];
                  additionalProperties?: boolean;
                  properties?: Record<string, { type?: string }>;
                };
              };
            }>;
          };
        }
      | undefined;
    const approvalVariant = showViewTool?.inputSchema?.oneOf?.find(
      (variant) => variant.properties?.purpose?.enum?.[0] === "approval-card",
    );

    expect(approvalVariant?.properties?.data).toMatchObject({
      required: ["title"],
      additionalProperties: false,
      properties: {
        title: expect.objectContaining({ type: "string" }),
        body: expect.objectContaining({ type: "string" }),
        actions: expect.objectContaining({ type: "array" }),
      },
    });
    expect(toolResults).toEqual([
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-approval",
        toolName: "show_view",
        output: expect.objectContaining({
          action: RENDER_VIEW_DIRECTIVE,
          view: "renderer",
          rendererSlug: "approval-card",
          data: expect.objectContaining({
            title: "Confirm this question?",
            body: "Should I continue?",
          }),
        }),
      }),
    ]);
  });

  it("rejects model-emitted show_view calls with no renderer data", async () => {
    const model = new MockLanguageModelV3({
      modelId: "renderer-contract-model",
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-empty-approval",
              toolName: "show_view",
              input: JSON.stringify({
                purpose: "approval-card",
              }),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage,
            },
          ],
        }),
      }),
    });
    const tools = createUiTools({
      viewRendererDefinitions: [approvalRendererDefinition],
      viewRendererRules:
        "- Purpose `approval-card`: Use this purpose when Kody asks the user for approval.\n" +
        "  Data keys:\n" +
        "  - title (text): Short approval question.",
    });

    const result = streamText({
      model,
      messages: [
        {
          role: "user",
          content: "aske me a q and ask for approval to confirm it",
        },
      ],
      tools: {
        show_view: tools.show_view,
      },
      toolChoice: { type: "tool", toolName: "show_view" },
      stopWhen: ({ steps }) => steps.length > 0,
    });

    const toolCalls = await result.toolCalls;
    const toolResults = await result.toolResults;

    expect(toolResults).toEqual([]);
    expect(toolCalls).toEqual([
      expect.objectContaining({
        toolCallId: "call-empty-approval",
        toolName: "show_view",
        invalid: true,
        error: expect.objectContaining({
          message: expect.stringContaining("show_view requires data"),
        }),
      }),
    ]);
  });

  it("repairs an empty model-emitted show_view call before executing the renderer", async () => {
    resolveBestViewRendererDefinitionMock.mockResolvedValue({
      definition: approvalRendererDefinition,
      source: "repo",
      sha: "approval-fixture",
      htmlUrl:
        "https://github.test/acme/app/views/renderers/approval-card.json",
    });

    const model = new MockLanguageModelV3({
      modelId: "renderer-contract-model",
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-empty-approval",
              toolName: "show_view",
              input: "{}",
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage,
            },
          ],
        }),
      }),
    });
    const tools = createUiTools({
      viewRendererDefinitions: [approvalRendererDefinition],
      viewRendererRules:
        "- Purpose `approval-card`: Use this purpose when Kody asks the user for approval.\n" +
        "  Data keys:\n" +
        "  - title (text): Short approval question.",
    });

    const result = streamText({
      model,
      messages: [
        {
          role: "user",
          content: "aske me a q and ask for approval to confirm it",
        },
      ],
      tools: {
        show_view: tools.show_view,
      },
      toolChoice: { type: "tool", toolName: "show_view" },
      experimental_repairToolCall: async ({ toolCall }) => {
        return repairShowViewToolCall({
          toolCall,
          definitions: [approvalRendererDefinition],
          userText: "aske me a q and ask for approval to confirm it",
        });
      },
      stopWhen: ({ steps }) => steps.length > 0,
    });

    const toolResults = await result.toolResults;

    expect(toolResults).toEqual([
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-empty-approval",
        toolName: "show_view",
        output: expect.objectContaining({
          action: RENDER_VIEW_DIRECTIVE,
          rendererSlug: "approval-card",
          data: expect.objectContaining({
            title: expect.stringContaining("approval"),
          }),
        }),
      }),
    ]);
  });
});
