/**
 * Source-level structural tests for TaskList intake/backlog actions.
 *
 * The repo's Vitest setup runs in node mode without a DOM renderer, so this
 * follows the existing component source-assertion pattern.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_LIST_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/TaskList.tsx",
);
const SOURCE = readFileSync(TASK_LIST_PATH, "utf8");

describe("TaskList intake actions", () => {
  it("keeps the run action available in intake/backlog mode", () => {
    expect(SOURCE).toMatch(
      /const canExecute = !isClosed && task\.column === "open" && onExecuteTask;/,
    );
    expect(SOURCE).toMatch(/Assign and run/);
  });

  it("keeps backlog closing scoped to intake mode and open issues", () => {
    expect(SOURCE).toMatch(/const canCloseBacklogItem =\s*intakeMode/);
    expect(SOURCE).toMatch(/task\.state === "open"/);
    expect(SOURCE).toMatch(/task\.column === "open"/);
    expect(SOURCE).toMatch(/Close backlog item/);
  });

  it("uses one icon-only toggle for Kody backlog assignment", () => {
    expect(SOURCE).toMatch(/onUnassignFromKody\?: \(task: KodyTask\) => void;/);
    expect(SOURCE).toMatch(
      /const isBacklogIntakeTask =\s*intakeMode && !isClosed && task\.column === "open";/,
    );
    expect(SOURCE).toMatch(
      /const canToggleKodyBacklog =\s*isBacklogIntakeTask/,
    );
    expect(SOURCE).toMatch(
      /isAssignedBacklogTask \? !!onUnassignFromKody : !!onAssignToKody/,
    );
    expect(SOURCE).toMatch(/aria-pressed=\{isAssignedBacklogTask\}/);
    expect(SOURCE).toMatch(/onUnassignFromKody\?\.\(task\);/);
    expect(SOURCE).toMatch(/<Bot className="w-4 h-4" \/>/);
    expect(SOURCE).not.toMatch(
      /\{isAssignedBacklogTask \? "Assigned" : "Unassigned"\}/,
    );
  });

  it("tints assigned backlog rows", () => {
    expect(SOURCE).toMatch(/bg-blue-500\/\[0\.05\] border-s-blue-400\/70/);
  });

  it("does not print the redundant backlog status label inside intake cards", () => {
    expect(SOURCE).toContain(
      'const showGateLabel = task.column !== "done" && !isBacklogIntakeTask;',
    );
    expect(SOURCE).toContain("{showGateLabel && (");
    expect(SOURCE).not.toContain('{task.column !== "done" && (');
  });

  it("renders only the task title with automatic text direction", () => {
    expect(SOURCE).toContain(
      'import { textDirectionProps } from "../text-direction";',
    );
    expect(SOURCE).toContain(
      "const taskTitleDirectionProps = textDirectionProps(task.title);",
    );
    expect(SOURCE).toMatch(/<h3\s+\{\.\.\.taskTitleDirectionProps\}/);
    expect(SOURCE).not.toMatch(/<div\s+\{\.\.\.taskTitleDirectionProps\}/);
    expect(SOURCE).toContain("text-start");
  });

  it("keeps row stripes and status-bar indents on the logical start side", () => {
    expect(SOURCE).toContain("border-s-2 border-s-transparent");
    expect(SOURCE).toContain("ps-[52px]");
    expect(SOURCE).not.toMatch(/border-l-/);
    expect(SOURCE).not.toMatch(/pl-\[52px\]/);
  });

  it("swallows close-item pointer and click events before opening the confirm dialog", () => {
    expect(SOURCE).toMatch(/const \[actionsMenuOpen, setActionsMenuOpen\]/);
    expect(SOURCE).toMatch(/const openCloseIssueConfirm = useCallback/);
    expect(SOURCE).toMatch(
      /onPointerDown=\{\(e\) => \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*openCloseIssueConfirm\(\);/,
    );
    expect(SOURCE).toMatch(
      /onClick=\{\(e\) => \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);/,
    );
    expect(SOURCE).toMatch(
      /onSelect=\{\(e\) => \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*openCloseIssueConfirm\(\);/,
    );
  });
});
