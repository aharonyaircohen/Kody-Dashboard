import { describe, expect, it } from "vitest";

import {
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

  it("keeps body-only draft item rows invalid", () => {
    expect(
      hasInvalidCreateTodoDraftItems([
        { title: "", body: "This note needs an item title." },
      ]),
    ).toBe(true);
  });
});
