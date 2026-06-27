import { describe, expect, it } from "vitest";

import { todoListSelectionRedirect } from "@dashboard/lib/todos/selection";

describe("todo list selection routing", () => {
  it("does not auto-select the first list when no list is selected", () => {
    expect(todoListSelectionRedirect(null, ["first", "second"])).toBeNull();
  });

  it("keeps valid selected todo list routes in place", () => {
    expect(todoListSelectionRedirect("second", ["first", "second"])).toBeNull();
  });

  it("clears a selected todo list route that no longer exists", () => {
    expect(todoListSelectionRedirect("missing", ["first", "second"])).toBe(
      "/todos",
    );
  });
});
