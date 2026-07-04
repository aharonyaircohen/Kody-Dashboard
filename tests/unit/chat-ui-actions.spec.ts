/**
 * Unit tests for chat UI directive validators.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import {
  RENDER_VIEW_DIRECTIVE,
  getRenderedViewUi,
  isRenderedViewDirective,
} from "@dashboard/lib/chat-ui-actions";

describe("isRenderedViewDirective", () => {
  it("accepts a generic renderer view directive", () => {
    expect(
      isRenderedViewDirective({
        action: RENDER_VIEW_DIRECTIVE,
        view: "renderer",
        id: "view-1",
        rendererSlug: "my-renderer",
        rendererName: "My renderer",
        resultTarget: "chat",
        blocks: [
          { type: "title", bind: "title" },
          { type: "text", bind: "body" },
          { type: "buttons", bind: "actions" },
          { type: "selection", bind: "items" },
        ],
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
          items: [
            {
              id: "one",
              label: "Option one",
              response: "one",
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("rejects unknown renderer block types and unsafe result targets", () => {
    expect(
      isRenderedViewDirective({
        action: RENDER_VIEW_DIRECTIVE,
        view: "renderer",
        id: "view-1",
        rendererSlug: "my-renderer",
        rendererName: "My renderer",
        resultTarget: "api",
        blocks: [{ type: "script", bind: "code" }],
        data: {},
      }),
    ).toBe(false);
  });

  it("normalizes legacy renderer blocks into generic UI atoms", () => {
    const ui = getRenderedViewUi({
      action: RENDER_VIEW_DIRECTIVE,
      view: "renderer",
      id: "view-1",
      rendererSlug: "my-renderer",
      rendererName: "My renderer",
      resultTarget: "chat",
      blocks: [
        { type: "title", bind: "title" },
        { type: "text", bind: "body" },
        { type: "buttons", bind: "actions" },
        { type: "selection", bind: "items", label: "Pick one" },
      ],
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
        items: [
          {
            id: "one",
            label: "Option one",
            response: "one",
          },
        ],
      },
    });

    expect(ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "Choose next step", variant: "title" },
        {
          type: "text",
          value: "Pick one option before continuing.",
          variant: "body",
        },
        {
          type: "row",
          children: [
            {
              type: "button",
              label: "Continue",
              action: { id: "continue" },
            },
          ],
        },
        {
          type: "stack",
          children: [
            { type: "text", value: "Pick one", variant: "label" },
            {
              type: "list",
              children: [
                {
                  type: "button",
                  label: "Option one",
                  action: { id: "one" },
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
