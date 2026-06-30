import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TODO_CONTROL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/TodoControl.tsx"),
  "utf8",
);

describe("todo item cards", () => {
  it("selects item routes from card clicks without stealing control clicks", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      "function isTodoItemCardClickIgnored(",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "\"button,a,input,textarea,select,[role='button'],[role='menuitem'],[data-todo-item-control]\"",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "isTodoItemCardClickIgnored(event.target, event.currentTarget)",
    );
    expect(TODO_CONTROL_SOURCE).toContain("function stopTodoItemActionClick(");
    expect(TODO_CONTROL_SOURCE).toContain("event.stopPropagation();");
    expect(TODO_CONTROL_SOURCE).toContain("data-todo-item-control");
    expect(TODO_CONTROL_SOURCE).toContain("onSelect();");
    expect(TODO_CONTROL_SOURCE).toContain("cursor-pointer");
  });

  it("saves item deletes before clearing a selected item route", () => {
    const deleteItemBlock = TODO_CONTROL_SOURCE.match(
      /const deleteItem = \(item: TodoItem\) => \{([\s\S]*?)\n  \};/,
    )?.[1];

    expect(deleteItemBlock).toContain("updateMutation.mutate(");
    expect(deleteItemBlock).toContain(
      "items: list.items.filter((candidate) => candidate.id !== item.id)",
    );
    expect(deleteItemBlock).toContain("onSuccess");
    expect(deleteItemBlock).toContain("selectedItemId === item.id");
    expect(deleteItemBlock).toContain("onSelectItem(null, true)");
  });
});
