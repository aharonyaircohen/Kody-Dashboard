import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TODO_CONTROL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/TodoControl.tsx"),
  "utf8",
);

describe("todo item cards", () => {
  it("opens the edit dialog from card clicks without stealing control clicks", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      "function isTodoItemCardClickIgnored(",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "\"button,a,input,textarea,select,[role='button'],[data-todo-item-control]\"",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "isTodoItemCardClickIgnored(event.target, event.currentTarget)",
    );
    expect(TODO_CONTROL_SOURCE).toContain("onEdit();");
    expect(TODO_CONTROL_SOURCE).toContain("cursor-pointer");
  });
});
