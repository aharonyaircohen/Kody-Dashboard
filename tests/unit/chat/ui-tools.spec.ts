/**
 * @testFramework vitest
 * @domain kody-chat
 */
import { describe, expect, it } from "vitest";
import { asSchema } from "ai";
import { createUiTools } from "../../../app/api/kody/chat/tools/ui-tools";
import {
  FINAL_ANSWER_REQUIRES_VIEW_ERROR,
  FINAL_ANSWER_TOOL,
} from "@dashboard/lib/chat-output-tools";
import type { ViewRendererDefinition } from "@dashboard/lib/view-renderers/renderers";

describe("ui tools", () => {
  const decisionRenderer: ViewRendererDefinition = {
    slug: "decision-card",
    name: "Decision card",
    purpose: "decision",
    rule: "Use this purpose when Kody presents a decision.",
    data: {
      title: { type: "text", description: "Short heading." },
      body: { type: "text", description: "Supporting text." },
      actions: {
        type: "actions",
        description: "Available responses.",
      },
    },
    defaults: {
      actions: [
        {
          id: "continue",
          label: "Continue",
          response: "continue",
          variant: "primary",
        },
      ],
    },
    type: "layout",
    blocks: [
      { type: "title", bind: "title" },
      { type: "text", bind: "body" },
      { type: "buttons", bind: "actions" },
    ],
  };

  it("keeps renderer shape handling out of the generic chat tool", () => {
    const tools = createUiTools({
      viewRendererRules:
        "- Purpose `choice`: Use when choosing one.\n  Data keys:\n  - items (selection): Choices.",
    }) as Record<string, unknown>;
    const showView = tools.show_view as { description?: string };

    expect(showView).toBeTruthy();
    expect(String(showView.description)).toContain("Available renderer rules");
    expect(String(showView.description)).toContain(
      "Use this when the next user interaction matches an available renderer rule",
    );
  });

  it("exposes a generic final output tool", () => {
    const tools = createUiTools() as Record<string, unknown>;
    expect(tools[FINAL_ANSWER_TOOL]).toBeTruthy();
  });

  it("rejects plain final answers that should be rendered as user choices", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<{ error?: string }>;
    };

    await expect(
      finalAnswer.execute({
        content:
          "Want me to file this as a bug issue in the repo so a dev can pick it up, or should I draft the small code change here?",
      }),
    ).resolves.toEqual({
      error: FINAL_ANSWER_REQUIRES_VIEW_ERROR,
    });
  });

  it("keeps plain final answers for non-interactive text", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<{ content?: string }>;
    };

    await expect(
      finalAnswer.execute({
        content: "The bug is in the login redirect handler.",
      }),
    ).resolves.toEqual({
      content: "The bug is in the login redirect handler.",
    });
  });

  it("preserves renderer fields that arrive beside data instead of stripping them", async () => {
    const tools = createUiTools() as Record<string, unknown>;
    const showView = tools.show_view as {
      inputSchema: unknown;
      execute: (value: Record<string, unknown>) => Promise<{ error?: string }>;
    };

    const input = {
      purpose: "approval-card",
      data: {},
      title: "Confirm?",
      body: "Should I continue?",
    };

    await expect(showView.execute(input)).resolves.not.toMatchObject({
      error: "show_view requires data",
    });
  });

  it("advertises renderer data as an open object in the provider schema", async () => {
    const tools = createUiTools() as Record<string, unknown>;
    const showView = tools.show_view as {
      inputSchema: Parameters<typeof asSchema>[0];
    };

    const schema = await asSchema(showView.inputSchema).jsonSchema;

    expect(schema).toMatchObject({
      type: "object",
      required: ["purpose", "data"],
      properties: {
        data: {
          type: "object",
          minProperties: 1,
          additionalProperties: true,
        },
      },
    });
  });

  it("advertises renderer-specific data fields when definitions are loaded", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const showView = tools.show_view as {
      inputSchema: Parameters<typeof asSchema>[0];
    };

    const schema = (await asSchema(showView.inputSchema).jsonSchema) as {
      type: string;
      oneOf: Array<{
        properties: {
          purpose: { enum: string[] };
          data: {
            required: string[];
            properties: Record<string, { type?: string }>;
          };
        };
      }>;
    };
    const decisionVariant = schema.oneOf.find(
      (variant) => variant.properties.purpose.enum[0] === "decision",
    );
    const slugVariant = schema.oneOf.find(
      (variant) => variant.properties.purpose.enum[0] === "decision-card",
    );

    expect(schema.type).toBe("object");
    expect(decisionVariant?.properties.data).toMatchObject({
      required: ["title", "body"],
      properties: {
        title: expect.objectContaining({ type: "string" }),
        body: expect.objectContaining({ type: "string" }),
        actions: expect.objectContaining({ type: "array" }),
      },
    });
    expect(slugVariant?.properties.purpose.enum).toEqual(["decision-card"]);
  });
});
