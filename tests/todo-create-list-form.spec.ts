import { describe, expect, it } from "vitest";

import {
  buildCreateTodoListPayload,
  buildCreateTodoItemsPayload,
  hasInvalidCreateTodoDraftItems,
} from "@dashboard/lib/todos/create-list-form";

describe("todo create list form", () => {
  it("allows creating a list with no initial items", () => {
    expect(hasInvalidCreateTodoDraftItems([])).toBe(false);
    expect(buildCreateTodoItemsPayload([])).toEqual([]);
  });

  it("skips blank draft item rows instead of requiring an item", () => {
    const drafts = [
      { title: "", body: "" },
      { title: "  Checkout follow-ups  ", body: "Review the cart state." },
    ];

    expect(hasInvalidCreateTodoDraftItems(drafts)).toBe(false);
    expect(buildCreateTodoItemsPayload(drafts)).toEqual([
      { title: "Checkout follow-ups", body: "Review the cart state." },
    ]);
  });

  it("builds the create payload with a rich list description", () => {
    expect(
      buildCreateTodoListPayload({
        title: "  Checkout work  ",
        description: "## Scope\n\nTrack the checkout fixes.",
        items: [
          { title: "", body: "" },
          { title: "  Verify cart  ", body: "- Check empty state" },
        ],
      }),
    ).toEqual({
      title: "Checkout work",
      description: "## Scope\n\nTrack the checkout fixes.",
      items: [{ title: "Verify cart", body: "- Check empty state" }],
    });
  });

  it("keeps body-only draft item rows invalid", () => {
    expect(
      hasInvalidCreateTodoDraftItems([
        { title: "", body: "This note needs an item title." },
      ]),
    ).toBe(true);
  });
});
