import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TODO_CONTROL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/TodoControl.tsx"),
  "utf8",
);

describe("todo list header", () => {
  it("renders saved descriptions without adding a duplicate edit control", () => {
    const descriptionBlock = TODO_CONTROL_SOURCE.match(
      /\{hasListDescription \? \([\s\S]*?\) : null\}/,
    )?.[0];

    expect(descriptionBlock).toBeTruthy();
    expect(descriptionBlock).toContain("content={list.description}");
    expect(TODO_CONTROL_SOURCE).toContain("content={list.description}");
    expect(TODO_CONTROL_SOURCE).toContain("hasListDescription ? (");
    expect(TODO_CONTROL_SOURCE).not.toContain("Add description");
    expect(descriptionBlock).not.toContain("onClick={onEditList}");
  });

  it("keeps the filter panel attached to the header instead of a floating card", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      "max-w-5xl mx-auto px-4 pb-4 pt-4 md:px-8 md:pb-6 md:pt-8 space-y-5",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "space-y-2 border-t border-white/[0.06] pt-4",
    );
    expect(TODO_CONTROL_SOURCE).not.toContain(
      "rounded-md border border-border bg-card/40 p-3 space-y-3",
    );
  });

  it("removes duplicate todo stats from the filter header", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      "flex flex-wrap items-center justify-between gap-2",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "h-7 shrink-0 gap-1.5 px-2.5 text-xs",
    );
    expect(TODO_CONTROL_SOURCE).not.toContain(
      "flex items-start justify-between gap-3 text-xs",
    );
    expect(TODO_CONTROL_SOURCE).not.toContain("mt-0.5 text-muted-foreground");
    expect(TODO_CONTROL_SOURCE).not.toContain(
      "{stats.active} open · {stats.done} done",
    );
    expect(TODO_CONTROL_SOURCE).not.toContain(
      "`${progressPercent}% complete · ${stats.done}/${stats.total}`",
    );
  });
});
