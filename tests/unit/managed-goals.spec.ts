/**
 * @fileoverview Unit tests for managed goal helpers.
 * @testFramework vitest
 * @domain goals
 */

import { describe, expect, it } from "vitest";

import { goalStatePath } from "../../src/dashboard/lib/goal-state";
import {
  MANAGED_GOAL_TYPES,
  SIMPLE_MANAGED_GOAL_EVIDENCE,
  SIMPLE_MANAGED_GOAL_TEMPLATE,
  buildManagedGoalState,
  buildSimpleManagedGoalCreateInput,
  collapseManagedGoalRecordsForList,
  isStoreBackedManagedGoal,
  isManagedGoalState,
  managedGoalModel,
  managedGoalPath,
  type ManagedGoalRecord,
} from "../../src/dashboard/lib/managed-goals";

describe("managedGoalPath", () => {
  it("points to live goal instances, not templates or flat goal files", () => {
    expect(managedGoalPath("simple-rollout")).toBe(
      ".kody/goals/instances/simple-rollout/state.json",
    );
  });
});

describe("goalStatePath", () => {
  it("points Tasks-page goals to live goal instances", () => {
    expect(goalStatePath("legacy-dashboard-goal")).toBe(
      ".kody/goals/instances/legacy-dashboard-goal/state.json",
    );
  });
});

describe("isManagedGoalState", () => {
  it("accepts inactive Store templates", () => {
    expect(
      isManagedGoalState({
        version: 1,
        kind: "template",
        templateId: "web-release",
        state: "inactive",
        type: "web-release",
        destination: {
          outcome: "Release is deployed.",
          evidence: ["productionDeployed"],
        },
        duties: ["vercel-production-deploy"],
        route: [],
        facts: {},
        blockers: [],
      }),
    ).toBe(true);
  });
});

describe("simple managed goal creation", () => {
  it("exposes simple goal types for the create form", () => {
    expect(MANAGED_GOAL_TYPES.map((type) => type.id)).toEqual([
      "improve",
      "routine",
      "release",
      "checklist",
    ]);
  });

  it("describes every goal type without adding user inputs", () => {
    for (const type of MANAGED_GOAL_TYPES) {
      expect(type.description.trim().length).toBeGreaterThan(20);
      expect(type.bestFor.trim().length).toBeGreaterThan(20);
      expect(type.systemSummary.trim().length).toBeGreaterThan(20);
    }
  });

  it("builds a create payload from only type, schedule, and prompt", () => {
    const input = buildSimpleManagedGoalCreateInput({
      goalType: "release",
      schedule: "1h",
      prompt: "Publish Kody Dashboard to production safely.",
    });

    expect(input).toEqual({
      type: "release",
      schedule: "1h",
      outcome: "Publish Kody Dashboard to production safely.",
    });
  });

  it("expands selected type into system-filled goal structure", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "release",
        schedule: "1h",
        prompt: "Publish Kody Dashboard to production safely.",
      }),
    );

    expect(state).toMatchObject({
      type: "release",
      schedule: "1h",
      destination: {
        outcome: "Publish Kody Dashboard to production safely.",
        evidence: ["releasePrExists", "mainMerged", "productionDeployed"],
      },
      duties: ["release", "task-leader", "vercel-production-deploy"],
      route: [
        {
          stage: "release",
          evidence: "releasePrExists",
          duty: "release",
          executable: "release-prepare",
        },
        {
          stage: "merge",
          evidence: "mainMerged",
          duty: "task-leader",
          executable: "task-leader",
        },
        {
          stage: "publish",
          evidence: "productionDeployed",
          duty: "vercel-production-deploy",
          executable: "vercel-production-deploy",
        },
      ],
      facts: {
        goalType: "release",
      },
    });
  });

  it("builds route-free routine structure", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "routine",
        schedule: "1d",
        prompt: "Keep codebase healthy report drift.",
      }),
    );

    expect(state).toMatchObject({
      type: "routine",
      schedule: "1d",
      destination: {
        outcome: "Keep codebase healthy report drift.",
        evidence: [],
      },
      route: [],
      facts: { goalType: "routine" },
    });
    expect(state.duties).toContain("code-health");
    expect(state.duties).toContain("health-check");
  });

  it("uses selected duties when creating a routine", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "routine",
        schedule: "1d",
        prompt: "Keep docs healthy.",
        duties: ["docs-health", "qa-sweep"],
      }),
    );

    expect(state.duties).toEqual(["docs-health", "qa-sweep"]);
  });

  it("keeps legacy simple template goals route-free", () => {
    const state = buildManagedGoalState({
      templateId: SIMPLE_MANAGED_GOAL_TEMPLATE,
      type: SIMPLE_MANAGED_GOAL_TEMPLATE,
      schedule: "1d",
      outcome: "Watch production health.",
    });

    expect(state).toMatchObject({
      type: SIMPLE_MANAGED_GOAL_TEMPLATE,
      sourceTemplate: SIMPLE_MANAGED_GOAL_TEMPLATE,
      route: [],
      facts: {
        simpleAttachedTaskCount: 0,
        simpleOpenTaskCount: 0,
        [SIMPLE_MANAGED_GOAL_EVIDENCE]: false,
      },
    });
  });
});

describe("isStoreBackedManagedGoal", () => {
  it("treats sourceTemplate copies as Store-backed", () => {
    const goal: ManagedGoalRecord = {
      id: "simple",
      path: ".kody/goals/instances/simple/state.json",
      source: "local",
      recordType: "instance",
      state: {
        version: 1,
        sourceTemplate: "simple",
        state: "active",
        type: "simple",
        destination: {
          outcome: "Keep a simple goal tracked.",
          evidence: ["labelledTasksComplete"],
        },
        duties: [],
        route: [],
        facts: {},
        blockers: [],
      },
    };

    expect(isStoreBackedManagedGoal(goal)).toBe(true);
  });
});

describe("managedGoalModel", () => {
  function goal(
    overrides: Partial<ManagedGoalRecord["state"]>,
  ): ManagedGoalRecord {
    return {
      id: "model-test",
      path: ".kody/goals/instances/model-test/state.json",
      source: "local",
      recordType: "instance",
      state: {
        version: 1,
        state: "active",
        type: "release",
        destination: {
          outcome: "Release safely.",
          evidence: ["releasePrExists"],
        },
        duties: ["release"],
        route: [
          {
            stage: "release",
            evidence: "releasePrExists",
            duty: "release",
          },
        ],
        facts: {},
        blockers: [],
        ...overrides,
      },
    };
  }

  it("classifies routed evidence goals as objectives", () => {
    expect(managedGoalModel(goal({ type: "release" }))).toBe("objective");
  });

  it("classifies duty-cadence goals as routines", () => {
    expect(
      managedGoalModel(
        goal({
          type: "release",
          scheduleMode: "duty-cadence",
        }),
      ),
    ).toBe("routine");
  });

  it("classifies routine and legacy routine types as routines", () => {
    expect(managedGoalModel(goal({ type: "routine" }))).toBe("routine");
    expect(managedGoalModel(goal({ type: "maintain" }))).toBe("routine");
    expect(managedGoalModel(goal({ type: "monitor" }))).toBe("routine");
  });
});

describe("collapseManagedGoalRecordsForList", () => {
  function record(id: string, updatedAt: string): ManagedGoalRecord {
    return {
      id,
      path: `.kody/goals/instances/${id}/state.json`,
      source: "local",
      recordType: "instance",
      state: {
        version: 1,
        kind: "instance",
        templateId: "five-minute-goal-smoke",
        sourceTemplate: "five-minute-goal-smoke",
        state: "active",
        type: "monitor",
        destination: {
          outcome: "Verify recurring scheduling.",
          evidence: ["companyGraphRefreshed"],
        },
        duties: ["company-graph"],
        route: [],
        facts: {},
        blockers: [],
        updatedAt,
      },
    };
  }

  it("groups generated scheduled instances under their template id", () => {
    const goals = collapseManagedGoalRecordsForList([
      record("five-minute-goal-smoke-b5940142", "2026-06-21T11:50:54Z"),
      record("five-minute-goal-smoke-b5940143", "2026-06-21T11:58:23Z"),
    ]);

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      id: "five-minute-goal-smoke",
      recordType: "template",
      updatedAt: "2026-06-21T11:58:23Z",
      state: {
        sourceTemplate: "five-minute-goal-smoke",
        latestInstanceId: "five-minute-goal-smoke-b5940143",
        instanceCount: 2,
        instanceIds: [
          "five-minute-goal-smoke-b5940142",
          "five-minute-goal-smoke-b5940143",
        ],
        instances: [
          {
            id: "five-minute-goal-smoke-b5940143",
            state: "active",
            updatedAt: "2026-06-21T11:58:23Z",
            facts: {},
            blockers: [],
          },
          {
            id: "five-minute-goal-smoke-b5940142",
            state: "active",
            updatedAt: "2026-06-21T11:50:54Z",
            facts: {},
            blockers: [],
          },
        ],
      },
    });
  });
});
