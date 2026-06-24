/**
 * @fileoverview Regression tests for simple-template managed goals.
 * @testFramework vitest
 * @domain goals
 */

import { describe, expect, it } from "vitest";
import {
  collapseManagedGoalRecordsForList,
  type ManagedGoalRecord,
} from "../../src/dashboard/lib/managed-goals";

describe("collapseManagedGoalRecordsForList simple template", () => {
  it("keeps simple-created local goals under their own id", () => {
    const goal: ManagedGoalRecord = {
      id: "npm-release",
      path: "goals/instances/npm-release/state.json",
      source: "local",
      recordType: "instance",
      state: {
        version: 1,
        state: "active",
        type: "simple",
        sourceTemplate: "simple",
        destination: {
          outcome: "Tasks labelled goal:npm-release are complete.",
          evidence: ["labelledTasksComplete"],
        },
        agentResponsibilities: [],
        route: [],
        facts: {},
        blockers: [],
      },
    };

    const goals = collapseManagedGoalRecordsForList([goal]);

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      id: "npm-release",
      recordType: "instance",
      state: {
        sourceTemplate: "simple",
      },
    });
  });
});
