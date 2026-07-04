/**
 * @testFramework vitest
 * @domain view-renderers
 */
import { describe, expect, it } from "vitest";
import {
  buildRenderedViewDirective,
  buildViewRendererRulesPrompt,
  matchViewRendererDefinition,
  normalizeViewRendererData,
  parseViewRendererDefinition,
  serializeViewRendererDefinition,
  type ViewRendererDefinition,
} from "@dashboard/lib/view-renderers/renderers";

describe("view renderer definitions", () => {
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
    blocks: [
      { type: "title", bind: "title" },
      { type: "text", bind: "body" },
      { type: "buttons", bind: "actions" },
    ],
  };

  const choiceRenderer: ViewRendererDefinition = {
    slug: "choice-list",
    name: "Choice list",
    purpose: "choice",
    rule: "Use this purpose when Kody presents choices.",
    data: {
      items: {
        type: "selection",
        description: "Choices the user can select from.",
      },
    },
    type: "layout",
    blocks: [
      { type: "title", bind: "title" },
      { type: "text", bind: "body" },
      { type: "selection", bind: "items" },
    ],
  };

  it("parses a layout renderer", () => {
    const parsed = parseViewRendererDefinition(
      serializeViewRendererDefinition(decisionRenderer),
    );

    expect(parsed.slug).toBe("decision-card");
    expect(parsed.purpose).toBe("decision");
    expect(parsed.aliases).toEqual(["approval"]);
    expect(parsed.rule).toBeTruthy();
    expect(parsed.data?.title?.description).toBe("Short heading.");
    expect(parsed.defaults?.actions).toHaveLength(1);
    expect(parsed.type).toBe("layout");
    expect(parsed.blocks.map((block) => block.type)).toEqual([
      "title",
      "text",
      "buttons",
    ]);
  });

  it("formats renderer rules for the chat prompt", () => {
    const prompt = buildViewRendererRulesPrompt([
      decisionRenderer,
      choiceRenderer,
    ]);

    expect(prompt).toContain("Purpose `decision`");
    expect(prompt).toContain("Aliases: `approval`");
    expect(prompt).toContain("Data keys:");
    expect(prompt).toContain("  - title (title): Short heading.");
    expect(prompt).toContain(
      "  - actions (actions, default available): Available responses.",
    );
    expect(prompt).toContain("Purpose `choice`");
    expect(prompt).toContain(
      "  - items (selection): Choices the user can select from.",
    );
  });

  it("matches renderer aliases without hardcoded purpose names", () => {
    const matched = matchViewRendererDefinition(
      [decisionRenderer],
      "approval",
      {
        title: "Create this issue?",
      },
    );

    expect(matched?.slug).toBe("decision-card");
  });

  it("parses a selection block renderer", () => {
    const parsed = parseViewRendererDefinition(
      serializeViewRendererDefinition(choiceRenderer),
    );

    expect(parsed.slug).toBe("choice-list");
    expect(parsed.purpose).toBe("choice");
    expect(parsed.blocks.map((block) => block.type)).toEqual([
      "title",
      "text",
      "selection",
    ]);
  });

  it("rejects unknown block types", () => {
    expect(() =>
      parseViewRendererDefinition(
        JSON.stringify({
          slug: "bad-renderer",
          name: "Bad renderer",
          purpose: "bad",
          type: "layout",
          blocks: [{ type: "script", bind: "code" }],
        }),
      ),
    ).toThrow(/Invalid view renderer/);
  });

  it("builds a generic chat render directive", () => {
    const directive = buildRenderedViewDirective({
      id: "view-test",
      definition: decisionRenderer,
      data: {
        title: "Choose next step",
        body: "Pick one option before continuing.",
        actions: [
          {
            id: "continue",
            label: "Continue",
            response: "continue",
            variant: "primary",
          },
        ],
      },
    });

    expect(directive).toMatchObject({
      action: "render_view",
      view: "renderer",
      id: "view-test",
      rendererSlug: "decision-card",
      resultTarget: "chat",
    });
    expect(directive.blocks.map((block) => block.type)).toEqual([
      "title",
      "text",
      "buttons",
    ]);
    expect(directive.data.title).toBe("Choose next step");
  });

  it("adds a generic UI tree to rendered directives", () => {
    const directive = buildRenderedViewDirective({
      id: "view-test",
      definition: choiceRenderer,
      data: {
        title: "Choose one",
        body: "Pick one option.",
        items: ["Alpha", "Beta"],
      },
    });

    expect(directive.ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "Choose one", variant: "title" },
        { type: "text", value: "Pick one option.", variant: "body" },
        {
          type: "stack",
          children: [
            {
              type: "list",
              children: [
                {
                  type: "button",
                  label: "Alpha",
                  action: { id: "alpha", response: "alpha" },
                },
                {
                  type: "button",
                  label: "Beta",
                  action: { id: "beta", response: "beta" },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("fills missing fields from renderer defaults", () => {
    const directive = buildRenderedViewDirective({
      id: "view-test",
      definition: decisionRenderer,
      data: {
        title: "Choose next step",
      },
    });

    expect(directive.data.actions).toEqual(decisionRenderer.defaults?.actions);
  });

  it("normalizes renderer data using field types, not renderer names", () => {
    const data = normalizeViewRendererData(choiceRenderer, {
      title: "Choose one",
      items: ["Alpha", "Beta"],
    });

    expect(data.items).toEqual([
      { id: "alpha", label: "Alpha", response: "alpha" },
      { id: "beta", label: "Beta", response: "beta" },
    ]);
  });

  it("normalizes array-like tool data for list fields", () => {
    const data = normalizeViewRendererData(choiceRenderer, {
      title: "Choose one",
      items: {
        0: "op 1",
        1: "op2",
        2: "op 3",
      },
    });

    expect(data.items).toEqual([
      { id: "op-1", label: "op 1", response: "op-1" },
      { id: "op2", label: "op2", response: "op2" },
      { id: "op-3", label: "op 3", response: "op-3" },
    ]);
  });

  it("normalizes single-key tool wrappers for list fields", () => {
    const data = normalizeViewRendererData(choiceRenderer, {
      title: "Choose one",
      items: {
        anything: ["Alpha", "Beta"],
      },
    });

    expect(data.items).toEqual([
      { id: "alpha", label: "Alpha", response: "alpha" },
      { id: "beta", label: "Beta", response: "beta" },
    ]);
  });

  it("matches the renderer whose binds best fit the data", () => {
    const titleOnly = {
      slug: "title-only",
      name: "Title only",
      purpose: "decision",
      type: "layout" as const,
      blocks: [{ type: "title" as const, bind: "title" }],
    };
    const titleBodyActions = {
      slug: "title-body-actions",
      name: "Title body actions",
      purpose: "decision",
      type: "layout" as const,
      blocks: [
        { type: "title" as const, bind: "title" },
        { type: "text" as const, bind: "body" },
        { type: "buttons" as const, bind: "actions" },
      ],
    };

    expect(
      matchViewRendererDefinition([titleOnly, titleBodyActions], "decision", {
        title: "Choose next step",
        body: "Pick one option before continuing.",
        actions: [{ id: "continue", label: "Continue", response: "continue" }],
      })?.slug,
    ).toBe("title-body-actions");
  });

  it("falls back to a partial renderer when no exact shape exists", () => {
    const matched = matchViewRendererDefinition(
      [decisionRenderer],
      "decision",
      {
        title: "Choose next step",
      },
    );

    expect(matched?.slug).toBe("decision-card");
  });
});
