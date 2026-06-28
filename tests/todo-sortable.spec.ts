import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TODO_CONTROL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/TodoControl.tsx"),
  "utf8",
);

describe("todo item sorting", () => {
  it("wires todo items through sortable drag and drop", () => {
    expect(TODO_CONTROL_SOURCE).toContain("DndContext");
    expect(TODO_CONTROL_SOURCE).toContain("SortableContext");
    expect(TODO_CONTROL_SOURCE).toContain("useSortable");
    expect(TODO_CONTROL_SOURCE).toContain("verticalListSortingStrategy");
    expect(TODO_CONTROL_SOURCE).toContain("handleTodoDragEnd");
    expect(TODO_CONTROL_SOURCE).toMatch(
      /reorderTodoItems\(\s*list\.items,\s*filteredItems,/,
    );
  });

  it("uses a dedicated drag handle so card clicks still open edit", () => {
    expect(TODO_CONTROL_SOURCE).toContain("GripVertical");
    expect(TODO_CONTROL_SOURCE).toContain(
      "aria-label={`Reorder ${item.title}`}",
    );
    expect(TODO_CONTROL_SOURCE).toContain("touch-none cursor-grab");
    expect(TODO_CONTROL_SOURCE).toContain("setSortableNodeRef");
    expect(TODO_CONTROL_SOURCE).toContain("sortableTransform");
  });
});
