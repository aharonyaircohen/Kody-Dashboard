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
        ui: {
          type: "stack",
          children: [
            { type: "text", value: "Choose next step", variant: "title" },
            {
              type: "button",
              label: "Continue",
              action: {
                id: "continue",
                label: "Continue",
                response: "continue",
                variant: "primary",
              },
            },
            {
              type: "checkbox",
              name: "selected",
              value: "one",
              label: "Option one",
            },
            { type: "submit", label: "Confirm" },
          ],
        },
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
        ui: { type: "text", value: "Unsafe target" },
        data: {},
      }),
    ).toBe(false);
  });

  it("returns the generic UI atoms from the directive", () => {
    const ui = getRenderedViewUi({
      action: RENDER_VIEW_DIRECTIVE,
      view: "renderer",
      id: "view-1",
      rendererSlug: "my-renderer",
      rendererName: "My renderer",
      resultTarget: "chat",
      ui: {
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
                action: {
                  id: "continue",
                  label: "Continue",
                  response: "continue",
                  variant: "primary",
                },
              },
            ],
          },
        ],
      },
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
      ],
    });
  });
});
