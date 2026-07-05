import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TODO_CONTROL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/TodoControl.tsx"),
  "utf8",
);

describe("todo list header", () => {
  it("uses the selected todo list title in the page header", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      'const headerTitle = selectedList?.title ?? "Todos";',
    );
    expect(TODO_CONTROL_SOURCE).toContain("title={headerTitle}");
    expect(TODO_CONTROL_SOURCE).toContain("{headerTitle}");
    expect(TODO_CONTROL_SOURCE).not.toContain('title="Todos"');
  });

  it("keeps list actions as icon-only page-header buttons", () => {
    const headerActionsBlock = TODO_CONTROL_SOURCE.match(
      /const headerActions = \([\s\S]*?\n  \);/,
    )?.[0];

    expect(headerActionsBlock).toBeTruthy();
    expect(headerActionsBlock).toContain('aria-label="Refresh todo lists"');
    expect(headerActionsBlock).toContain('title="Refresh todo lists"');
    expect(headerActionsBlock).toContain(
      "aria-label={`Edit ${selectedList.title}`}",
    );
    expect(headerActionsBlock).toContain('title="Edit list"');
    expect(headerActionsBlock).toContain(
      "aria-label={`Delete ${selectedList.title}`}",
    );
    expect(headerActionsBlock).toContain('title="Delete list"');
    expect(headerActionsBlock).toContain('aria-label="New todo list"');
    expect(headerActionsBlock).toContain('title="New list"');
    expect(headerActionsBlock).toContain('className="w-10 px-0"');
    expect(headerActionsBlock).not.toContain(">New list<");
    expect(headerActionsBlock).not.toContain("hidden sm:inline");
  });

  it("does not keep a duplicate list-action menu in the detail header", () => {
    expect(TODO_CONTROL_SOURCE).not.toContain('aria-label="List actions"');
    expect(TODO_CONTROL_SOURCE).not.toContain('title="List actions"');
    expect(TODO_CONTROL_SOURCE).not.toContain("onEditList");
    expect(TODO_CONTROL_SOURCE).not.toContain("onDeleteList");
  });

  it("renders saved descriptions without adding a duplicate edit control", () => {
    const descriptionBlock = TODO_CONTROL_SOURCE.match(
      /\{hasListDescription \? \([\s\S]*?\) : null\}/,
    )?.[0];

    expect(descriptionBlock).toBeTruthy();
    expect(TODO_CONTROL_SOURCE).toContain("content={list.description}");
    expect(TODO_CONTROL_SOURCE).toContain("hasListDescription ? (");
    expect(TODO_CONTROL_SOURCE).not.toContain("Add description");
  });

  it("lets the list header description collapse without losing the content", () => {
    expect(TODO_CONTROL_SOURCE).toContain(
      "const [isDescriptionExpanded, setDescriptionExpanded] = useState(false);",
    );
    expect(TODO_CONTROL_SOURCE).toContain("function todoDescriptionPreview");
    expect(TODO_CONTROL_SOURCE).toContain(
      "const listDescriptionPreview = hasListDescription",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "const descriptionRegionId = `todo-list-description-${list.slug}`;",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "setDescriptionExpanded((isExpanded) => !isExpanded)",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "aria-controls={descriptionRegionId}",
    );
    expect(TODO_CONTROL_SOURCE).toContain(
      "aria-expanded={isDescriptionExpanded}",
    );
    expect(TODO_CONTROL_SOURCE).toContain("Description");
    expect(TODO_CONTROL_SOURCE).toContain("Hide description");
    expect(TODO_CONTROL_SOURCE).toContain("Show description");
    expect(TODO_CONTROL_SOURCE).toContain("title={listDescriptionPreview}");
    expect(TODO_CONTROL_SOURCE).toContain("{listDescriptionPreview}");
    expect(TODO_CONTROL_SOURCE).toContain("{isDescriptionExpanded ? (");
    expect(TODO_CONTROL_SOURCE).toContain("content={list.description}");
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

  it("shows managed todo state as compact header badges", () => {
    expect(TODO_CONTROL_SOURCE).toContain("function todoStateBadges");
    expect(TODO_CONTROL_SOURCE).toContain("const stateBadges =");
    expect(TODO_CONTROL_SOURCE).toContain('{ label: "Version"');
    expect(TODO_CONTROL_SOURCE).toContain('{ label: "State"');
    expect(TODO_CONTROL_SOURCE).toContain('{ label: "Stage"');
    expect(TODO_CONTROL_SOURCE).toContain("stateBadges.map");
    expect(TODO_CONTROL_SOURCE).not.toContain("function TodoStatePanel");
    expect(TODO_CONTROL_SOURCE).not.toContain('label: "Last decision"');
    expect(TODO_CONTROL_SOURCE).not.toContain("scheduleState?.lastGoalTickAt");
  });

  it("defaults the list-type filter to lists without an all button", () => {
    const listFilterBlock = TODO_CONTROL_SOURCE.match(
      /const TODO_LIST_FILTERS[\s\S]*?];/,
    )?.[0];

    expect(listFilterBlock).toBeTruthy();
    expect(listFilterBlock).toContain('["list", "goal", "loop"]');
    expect(listFilterBlock).not.toContain('"all"');
    expect(TODO_CONTROL_SOURCE).toContain("TODO_LIST_FILTER_STORAGE_KEY");
    expect(TODO_CONTROL_SOURCE).toContain("usePersistedState<TodoListFilter>");
    expect(TODO_CONTROL_SOURCE).toContain(
      "grid grid-cols-3 gap-1 rounded-md border border-white/[0.08] bg-black/30 p-1",
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
