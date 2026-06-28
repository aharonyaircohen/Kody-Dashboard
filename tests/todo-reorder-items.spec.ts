import { describe, expect, it } from "vitest";

import type { TodoItem } from "@dashboard/lib/api";
import { reorderTodoItems } from "@dashboard/lib/todos/reorder-items";

const baseItem = {
  body: "",
  assignee: null,
  completed: false,
  createdAt: "2026-06-28T00:00:00.000Z",
  completedAt: null,
} satisfies Omit<TodoItem, "id" | "title">;

const item = (id: string, completed = false): TodoItem => ({
  ...baseItem,
  id,
  title: id,
  completed,
});

describe("reorderTodoItems", () => {
  it("moves an item within the full list", () => {
    const items = [item("a"), item("b"), item("c")];

    const reordered = reorderTodoItems(items, items, "c", "a");

    expect(reordered.map((todo) => todo.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps hidden filter results in their existing slots", () => {
    const items = [item("a"), item("hidden", true), item("b"), item("c")];
    const visibleItems = items.filter((todo) => !todo.completed);

    const reordered = reorderTodoItems(items, visibleItems, "c", "a");

    expect(reordered.map((todo) => todo.id)).toEqual(["c", "hidden", "a", "b"]);
  });

  it("returns the original array when the drag target is invalid", () => {
    const items = [item("a"), item("b"), item("c")];

    expect(reorderTodoItems(items, items, "c", "missing")).toBe(items);
    expect(reorderTodoItems(items, items, "a", "a")).toBe(items);
  });
});
