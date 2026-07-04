/**
 * @testFramework vitest
 * @domain view-renderers
 */
import { describe, expect, it } from "vitest";
import type { ViewRendererDefinition } from "@dashboard/lib/view-renderers/renderers";
import {
  buildFallbackShowViewInput,
  buildShowViewInputJsonSchema,
  repairShowViewToolCall,
  validateShowViewInput,
} from "@dashboard/lib/view-renderers/chat-contract";

describe("view renderer chat contract", () => {
  const decisionRenderer: ViewRendererDefinition = {
    slug: "decision-card",
    name: "Decision card",
    purpose: "decision",
    aliases: ["approval"],
    rule: "Use this purpose when Kody presents a decision.",
    data: {
      title: { description: "Short heading." },
      body: { description: "Supporting text." },
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

  const choiceRenderer: ViewRendererDefinition = {
    slug: "choice-list",
    name: "Choice list",
    purpose: "choice",
    rule: "Use this purpose when Kody presents choices.",
    data: {
      title: {
        type: "text",
        description: "Short title.",
      },
      body: {
        type: "text",
        description: "Supporting text.",
      },
      items: {
        type: "selection",
        description: "Choices the user can select from.",
      },
    },
    type: "layout",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "$title", variant: "title" },
        { type: "text", value: "$body" },
        {
          type: "list",
          for: "$items",
          as: "item",
          item: { type: "button", label: "$item.label", action: "$item" },
        },
      ],
    },
  };

  it("builds a provider schema with renderer-specific required data keys", () => {
    const schema = buildShowViewInputJsonSchema([
      decisionRenderer,
      choiceRenderer,
    ]) as {
      type: string;
      oneOf: Array<{
        properties: {
          purpose: { enum: string[] };
          data: {
            required: string[];
            additionalProperties: boolean;
            properties: Record<
              string,
              {
                type?: string;
                items?: { anyOf?: Array<Record<string, unknown>> };
              }
            >;
          };
        };
      }>;
    };
    const decisionVariant = schema.oneOf.find(
      (variant) => variant.properties.purpose.enum[0] === "decision",
    );
    const choiceVariant = schema.oneOf.find(
      (variant) => variant.properties.purpose.enum[0] === "choice",
    );

    expect(schema.type).toBe("object");
    expect(decisionVariant?.properties.data).toMatchObject({
      required: ["title", "body"],
      additionalProperties: false,
      properties: {
        title: expect.objectContaining({ type: "string" }),
        body: expect.objectContaining({ type: "string" }),
        actions: expect.objectContaining({ type: "array" }),
      },
    });
    expect(choiceVariant?.properties.data).toMatchObject({
      required: ["title", "body", "items"],
      properties: {
        items: expect.objectContaining({ type: "array" }),
      },
    });
    expect(
      choiceVariant?.properties.data.properties.items.items?.anyOf,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "object",
          additionalProperties: true,
        }),
      ]),
    );
  });

  it("normalizes valid show_view input", () => {
    expect(
      validateShowViewInput({
        purpose: "decision",
        title: "Continue?",
        body: "Confirm before moving on.",
      }),
    ).toEqual({
      success: true,
      value: {
        purpose: "decision",
        data: {
          title: "Continue?",
          body: "Confirm before moving on.",
        },
        title: "Continue?",
        body: "Confirm before moving on.",
      },
    });
  });

  it("rejects empty show_view input before execution", () => {
    expect(validateShowViewInput({})).toEqual({
      success: false,
      error: expect.objectContaining({
        message: "show_view purpose is required",
      }),
    });
  });

  it("builds fallback show_view input from renderer rules and user text", () => {
    const fallback = buildFallbackShowViewInput({
      definitions: [decisionRenderer, choiceRenderer],
      userText: "aske me a q and ask for approval to confirm it",
    });

    expect(fallback).toEqual({
      purpose: "decision",
      data: {
        title: "aske me a q and ask for approval to confirm it",
        body: "aske me a q and ask for approval to confirm it",
      },
    });
  });

  it("does not invent fallback list items when selectable data is missing", () => {
    const fallback = buildFallbackShowViewInput({
      definitions: [choiceRenderer],
      userText: "list reports and allow me to select a few",
    });

    expect(fallback).toBeNull();
  });

  it("repairs missing list data from prior read/list tool results", () => {
    const fallback = buildFallbackShowViewInput({
      definitions: [choiceRenderer],
      userText: "list reports and allow me to select a few",
      context: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolName: "list_reports",
              output: {
                reports: [
                  { slug: "cto", title: "CTO Report" },
                  { slug: "security-audit", title: "Security Audit" },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(fallback).toEqual({
      purpose: "choice",
      data: {
        title: "list reports and allow me to select a few",
        body: "list reports and allow me to select a few",
        items: [
          { slug: "cto", title: "CTO Report" },
          { slug: "security-audit", title: "Security Audit" },
        ],
      },
    });
  });

  it("repairs an invalid show_view tool call through the renderer contract", () => {
    const repaired = repairShowViewToolCall({
      toolCall: {
        toolName: "show_view",
        input: "{}",
      },
      definitions: [decisionRenderer],
      userText: "aske me a q and ask for approval to confirm it",
    });

    expect(repaired).toEqual({
      toolName: "show_view",
      input: JSON.stringify({
        purpose: "decision",
        data: {
          title: "aske me a q and ask for approval to confirm it",
          body: "aske me a q and ask for approval to confirm it",
        },
      }),
    });
  });
});
