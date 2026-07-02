import { describe, expect, it } from "vitest";
import { findCachedPRCIStatus } from "@dashboard/lib/hooks/usePRCIStatus";
import type { KodyTask, TasksResponse } from "@dashboard/lib/types";

function task(issueNumber: number, prNumber: number): KodyTask {
  return {
    id: String(issueNumber),
    issueNumber,
    title: "Task",
    body: "",
    state: "open",
    labels: [],
    column: "review",
    kodyPhase: null,
    kodyFlow: null,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    assignees: [],
    isKodyAssigned: true,
    associatedPR: {
      id: prNumber,
      number: prNumber,
      title: "PR",
      state: "open",
      head: { ref: "feature", sha: "abc" },
      html_url: `https://github.com/o/r/pull/${prNumber}`,
      merged_at: null,
      ciStatus: "success",
      mergeable: true,
      hasConflicts: false,
    },
  };
}

describe("findCachedPRCIStatus", () => {
  it("reads PR status from paged task responses without treating them as arrays", () => {
    const response: TasksResponse = {
      tasks: [task(702, 703)],
      columns: ["review"],
      pagination: {
        page: 1,
        perPage: 20,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      },
    };

    expect(
      findCachedPRCIStatus(
        [
          [["kody-tasks", undefined, false, "all"], []],
          [["kody-tasks", undefined, false, "running", undefined], response],
        ],
        703,
      ),
    ).toEqual({
      ciStatus: "success",
      mergeable: true,
      hasConflicts: false,
    });
  });
});
