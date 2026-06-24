/**
 * @fileoverview Regression tests for managed goal list collapse state.
 * @testFramework vitest
 * @domain goals
 */
import { describe, expect, it } from "vitest";

import {
  collapseManagedGoalRecordsForList,
  type ManagedGoalRecord,
} from "../../src/dashboard/lib/managed-goals";

function goalRecord(
  id: string,
  state: "active" | "inactive",
  updatedAt: string,
): ManagedGoalRecord {
  return {
    id,
    path: `goals/instances/${id}/state.json`,
    source: "local",
    recordType: "instance",
    state: {
      version: 1,
      sourceTemplate: "five-minute-goal-smoke",
      state,
      type: "monitor",
      destination: {
        outcome: "Verify recurring scheduling.",
        evidence: ["companyGraphRefreshed"],
      },
      agentResponsibilities: ["company-graph"],
      route: [],
      facts: {},
      blockers: [],
      updatedAt,
    },
  };
}

describe("collapseManagedGoalRecordsForList state", () => {
  it("keeps an explicit inactive template override over active generated instances", () => {
    const templateOverride = goalRecord(
      "five-minute-goal-smoke",
      "inactive",
      "2026-06-21T12:00:00Z",
    );
    const activeInstance = goalRecord(
      "five-minute-goal-smoke-b5940143",
      "active",
      "2026-06-21T11:58:23Z",
    );

    const goals = collapseManagedGoalRecordsForList([
      templateOverride,
      activeInstance,
    ]);

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      id: "five-minute-goal-smoke",
      state: {
        state: "inactive",
        latestInstanceId: "five-minute-goal-smoke-b5940143",
        instanceCount: 1,
      },
    });
  });
});
