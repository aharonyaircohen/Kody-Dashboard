import { describe, expect, it } from "vitest";

import {
  filterVisibleTasks,
  markTaskHiddenInList,
  markTaskVisibleInList,
} from "@dashboard/lib/tasks/visibility";
import {
  HIDDEN_TASK_LABEL,
  INTERNAL_ISSUE_LABELS,
  TASK_LIST_EXCLUDED_LABELS,
} from "@dashboard/lib/constants";

const task = (
  issueNumber: number,
  labels: string[] = [],
  title = `Task ${issueNumber}`,
  body = "",
) => ({
  issueNumber,
  labels,
  title,
  body,
});

describe("task visibility", () => {
  it("filters hidden tasks out of dashboard-visible lists", () => {
    const visible = filterVisibleTasks([
      task(1),
      task(2, [HIDDEN_TASK_LABEL]),
      task(3, ["bug"]),
    ]);

    expect(visible.map((t) => t.issueNumber)).toEqual([1, 3]);
  });

  it("filters the system inbox feed even when the label is missing", () => {
    const visible = filterVisibleTasks([
      task(4, [], "Kody Inbox Feed"),
      task(5, [], "Normal task", "<!-- kody-inbox-feed-start -->"),
      task(6),
    ]);

    expect(visible.map((t) => t.issueNumber)).toEqual([6]);
  });

  it("marks a task hidden without duplicating the label", () => {
    const tasks = [task(4, [HIDDEN_TASK_LABEL])];

    expect(markTaskHiddenInList(tasks, 4)[0].labels).toEqual([
      HIDDEN_TASK_LABEL,
    ]);
  });

  it("marks a hidden task visible again", () => {
    const tasks = [task(4, [HIDDEN_TASK_LABEL, "bug"])];

    expect(markTaskVisibleInList(tasks, 4)[0].labels).toEqual(["bug"]);
  });

  it("excludes hidden and internal issues from the task list source", () => {
    expect(TASK_LIST_EXCLUDED_LABELS).toContain(HIDDEN_TASK_LABEL);
    for (const label of INTERNAL_ISSUE_LABELS) {
      expect(TASK_LIST_EXCLUDED_LABELS).toContain(label);
    }
  });
});
