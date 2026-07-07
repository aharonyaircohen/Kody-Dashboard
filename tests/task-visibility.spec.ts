import { describe, expect, it } from "vitest";

import {
  isDashboardIntakeIssue,
  isDashboardKodyOwnedIssue,
  isDashboardUnassignedIssue,
} from "@dashboard/lib/tasks/visibility";
import { filterTasksByView, getViewModeCounts } from "@dashboard/lib/utils";
import type { KodyTask } from "@dashboard/lib/types";

function task(overrides: Partial<KodyTask>): KodyTask {
  return {
    id: `issue-${overrides.issueNumber ?? 1}`,
    issueNumber: overrides.issueNumber ?? 1,
    title: overrides.title ?? "Task",
    body: overrides.body ?? "",
    state: overrides.state ?? "open",
    labels: overrides.labels ?? [],
    column: overrides.column ?? "open",
    kodyPhase: null,
    kodyFlow: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("dashboard issue visibility", () => {
  it("treats any non-excluded kody label as Kody-owned", () => {
    expect(
      isDashboardKodyOwnedIssue({
        labels: ["kody:qa"],
        assignees: [],
      }),
    ).toBe(true);
  });

  it("treats configured Kody assignees as Kody-owned", () => {
    expect(
      isDashboardKodyOwnedIssue(
        {
          labels: [],
          assignees: [{ login: "kody" }],
        },
        ["kody"],
      ),
    ).toBe(true);
  });

  it("keeps explicit hidden/internal exclusions out of Kody-owned results", () => {
    expect(
      isDashboardKodyOwnedIssue({
        labels: ["kody:running", "kody:hidden"],
        assignees: [{ login: "kody" }],
      }),
    ).toBe(false);
  });

  it("classifies normal open issues as unassigned dashboard intake", () => {
    expect(
      isDashboardUnassignedIssue({
        labels: ["bug"],
        assignees: [{ login: "human-reviewer" }],
      }),
    ).toBe(true);
  });

  it("does not classify kody-labeled issues as unassigned", () => {
    expect(
      isDashboardUnassignedIssue({
        labels: ["kody:deps-bump"],
        assignees: [],
      }),
    ).toBe(false);
  });

  it("keeps owned and unassigned issues in the unified intake", () => {
    expect(
      isDashboardIntakeIssue({
        labels: ["kody:deps-bump"],
        assignees: [],
      }),
    ).toBe(true);
    expect(
      isDashboardIntakeIssue({
        labels: ["bug"],
        assignees: [{ login: "human-reviewer" }],
      }),
    ).toBe(true);
  });
});

describe("dashboard view filtering", () => {
  const tasks = [
    task({ issueNumber: 1, column: "building" }),
    task({ issueNumber: 2, column: "open" }),
    task({ issueNumber: 3, column: "open", state: "closed" }),
  ];

  it("shows all non-terminal issues in the unassigned view", () => {
    expect(
      filterTasksByView(tasks, {
        viewMode: "unassigned",
        statusFilter: "all",
        labelFilter: "all",
        priorityFilter: "all",
      }).map((t) => t.issueNumber),
    ).toEqual([1, 2]);
  });

  it("counts unassigned from the current fetched issue set", () => {
    expect(getViewModeCounts(tasks)).toMatchObject({
      runningCount: 1,
      backlogCount: 1,
      unassignedCount: 2,
      historyCount: 1,
    });
  });

  it("keeps open failed tasks in the running view", () => {
    expect(
      filterTasksByView(
        [
          task({ issueNumber: 1, column: "building" }),
          task({ issueNumber: 2, column: "failed" }),
          task({ issueNumber: 3, column: "done" }),
          task({ issueNumber: 4, column: "open" }),
        ],
        {
          viewMode: "running",
          statusFilter: "all",
          labelFilter: "all",
          priorityFilter: "all",
        },
      ).map((t) => t.issueNumber),
    ).toEqual([1, 2]);
  });

  it("keeps history to closed and done tasks", () => {
    expect(
      filterTasksByView(
        [
          task({ issueNumber: 1, column: "building" }),
          task({ issueNumber: 2, column: "done" }),
          task({ issueNumber: 3, column: "failed" }),
          task({ issueNumber: 4, column: "open", state: "closed" }),
        ],
        {
          viewMode: "history",
          statusFilter: "all",
          labelFilter: "all",
          priorityFilter: "all",
        },
      ).map((t) => t.issueNumber),
    ).toEqual([2, 4]);
  });

  it("counts open failed tasks as running, not history", () => {
    expect(
      getViewModeCounts([
        task({ issueNumber: 1, column: "building" }),
        task({ issueNumber: 2, column: "failed" }),
        task({ issueNumber: 3, column: "done" }),
        task({ issueNumber: 4, column: "open" }),
      ]),
    ).toMatchObject({
      runningCount: 2,
      backlogCount: 1,
      historyCount: 1,
    });
  });
});
