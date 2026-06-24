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
  canDeleteManagedGoal,
  collapseManagedGoalRecordsForList,
  isStoreBackedManagedGoal,
  isManagedGoalState,
  managedGoalModel,
  managedGoalPath,
  normalizeManagedGoalState,
  type ManagedGoalRecord,
} from "../../src/dashboard/lib/managed-goals";

describe("managedGoalPath", () => {
  it("points to live goal instances, not templates or flat goal files", () => {
    expect(managedGoalPath("simple-rollout")).toBe(
      "goals/instances/simple-rollout/state.json",
    );
  });
});

describe("goalStatePath", () => {
  it("points Tasks-page goals to live goal instances", () => {
    expect(goalStatePath("legacy-dashboard-goal")).toBe(
      "goals/instances/legacy-dashboard-goal/state.json",
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
        agentResponsibilities: ["vercel-production-deploy"],
        route: [],
        facts: {},
        blockers: [],
      }),
    ).toBe(true);
  });
});

describe("normalizeManagedGoalState", () => {
  it("normalizes engine-written null agentResponsibilities from route", () => {
    const state = normalizeManagedGoalState({
      version: 1,
      state: "active",
      type: "improve",
      destination: {
        outcome: "Goal creation works.",
        evidence: ["planReady"],
      },
      agentResponsibilities: null,
      route: [
        {
          stage: "plan",
          evidence: "planReady",
          agentResponsibility: "plan",
          agentAction: "plan",
        },
      ],
      facts: {},
      blockers: [],
    });

    expect(state?.agentResponsibilities).toEqual(["plan"]);
    expect(state?.route[0]?.stage).toBe("plan");
  });

  it("accepts legacy duty goal state as agentResponsibilities", () => {
    const state = normalizeManagedGoalState({
      version: 1,
      state: "active",
      type: "routine",
      destination: {
        outcome: "Refresh company graph report.",
        evidence: ["companyGraphRefreshed"],
      },
      schedule: "1h",
      scheduleMode: "duty-cadence",
      duties: ["company-graph"],
      route: [
        {
          stage: "refresh-company-graph",
          evidence: "companyGraphRefreshed",
          duty: "company-graph",
          executable: "company-graph",
          args: { goal: { fact: "goalId" } },
        },
      ],
      facts: {},
      blockers: [],
    });

    expect(state).not.toBeNull();
    expect(state).toMatchObject({
      agentResponsibilities: ["company-graph"],
      route: [
        {
          stage: "refresh-company-graph",
          evidence: "companyGraphRefreshed",
          agentResponsibility: "company-graph",
          agentAction: "company-graph",
        },
      ],
    });
    expect(
      managedGoalModel({
        id: "legacy-loop",
        path: "goals/instances/legacy-loop/state.json",
        state: state!,
      }),
    ).toBe("agentLoop");
  });
  it("normalizes legacy web-release release dependency to release-prepare", () => {
    const state = normalizeManagedGoalState({
      version: 1,
      kind: "template",
      templateId: "web-release",
      state: "inactive",
      type: "web-release",
      destination: {
        outcome: "Release deployed.",
        evidence: ["releasePrExists", "mainMerged", "productionDeployed"],
      },
      agentResponsibilities: [
        "release",
        "release-merge",
        "vercel-production-deploy",
      ],
      route: [
        {
          stage: "release",
          evidence: "releasePrExists",
          agentResponsibility: "release",
          agentAction: "release-prepare",
        },
        {
          stage: "merge",
          evidence: "mainMerged",
          agentResponsibility: "release-merge",
          agentAction: "release-merge",
        },
        {
          stage: "publish",
          evidence: "productionDeployed",
          agentResponsibility: "vercel-production-deploy",
          agentAction: "vercel-production-deploy",
        },
      ],
      facts: {},
      blockers: [],
    });

    expect(state).not.toBeNull();
    expect(state?.agentResponsibilities).toEqual([
      "release-prepare",
      "release-merge",
      "vercel-production-deploy",
    ]);
    expect(state?.route.map((step) => step.agentResponsibility)).toEqual([
      "release-prepare",
      "release-merge",
      "vercel-production-deploy",
    ]);
    expect(state?.route.map((step) => step.agentAction)).toEqual([
      "release-prepare",
      "release-merge",
      "vercel-production-deploy",
    ]);
  });
});

describe("simple managed goal creation", () => {
  it("exposes simple goal types for the create form", () => {
    expect(MANAGED_GOAL_TYPES.map((type) => type.id)).toEqual([
      "improve",
      "agentLoop",
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
      agentResponsibilities: [
        "release",
        "task-leader",
        "vercel-production-deploy",
      ],
      route: [
        {
          stage: "release",
          evidence: "releasePrExists",
          agentResponsibility: "release",
          agentAction: "release-prepare",
        },
        {
          stage: "merge",
          evidence: "mainMerged",
          agentResponsibility: "task-leader",
          agentAction: "task-leader",
        },
        {
          stage: "publish",
          evidence: "productionDeployed",
          agentResponsibility: "vercel-production-deploy",
          agentAction: "vercel-production-deploy",
        },
      ],
      facts: {
        goalType: "release",
      },
    });
  });

  it("builds route-free targetless agentLoop structure", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "agentLoop",
        schedule: "1d",
        prompt: "Keep codebase healthy report drift.",
      }),
    );

    expect(state).toMatchObject({
      type: "agentLoop",
      schedule: "1d",
      scheduleMode: "agentLoop",
      destination: {
        outcome: "Keep codebase healthy report drift.",
        evidence: [],
      },
      route: [],
      facts: { goalType: "agentLoop" },
    });
    expect(state.agentResponsibilities).toEqual([]);
  });

  it("uses responsibility target creating agentLoop", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "agentLoop",
        schedule: "1d",
        prompt: "Keep docs healthy.",
        loopTarget: { type: "agentResponsibility", id: "docs-health" },
      }),
    );

    expect(state.loopTarget).toEqual({
      type: "agentResponsibility",
      id: "docs-health",
    });
    expect(state.agentResponsibilities).toEqual(["docs-health"]);
    expect(state.scheduleMode).toBe("agentLoop");
  });

  it("uses goal target creating agentLoop", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "agentLoop",
        schedule: "1d",
        prompt: "Release web daily.",
        loopTarget: { type: "goal", id: "web-release" },
      }),
    );

    expect(state.loopTarget).toEqual({ type: "goal", id: "web-release" });
    expect(state.agentResponsibilities).toEqual([]);
    expect(state.scheduleMode).toBe("agentLoop");
  });

  it("stores preferred run time when creating an agentLoop", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "agentLoop",
        schedule: "1d",
        preferredRunTime: { time: "09:30", timezone: "Asia/Jerusalem" },
        prompt: "Release web daily.",
        loopTarget: { type: "goal", id: "web-release" },
      }),
    );

    expect(state.preferredRunTime).toEqual({
      time: "09:30",
      timezone: "Asia/Jerusalem",
    });
  });

  it("keeps selected agentResponsibilities when creating a legacy agentLoop", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "agentLoop",
        schedule: "1d",
        prompt: "Keep docs healthy.",
        agentResponsibilities: ["docs-health", "qa-sweep"],
      }),
    );

    expect(state.agentResponsibilities).toEqual(["docs-health", "qa-sweep"]);
    expect(state.scheduleMode).toBe("agentLoop");
  });

  it("preserves user-managed route order for agentGoal creation", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "improve",
        schedule: "manual",
        prompt: "Make goal creation predictable.",
        agentResponsibilities: ["review", "plan"],
        evidence: ["changeVerified", "planReady"],
        route: [
          {
            stage: "review",
            evidence: "changeVerified",
            agentResponsibility: "review",
            agentAction: "review",
          },
          {
            stage: "plan",
            evidence: "planReady",
            agentResponsibility: "plan",
            agentAction: "plan",
          },
        ],
      }),
    );

    expect(state.destination.evidence).toEqual(["changeVerified", "planReady"]);
    expect(state.route.map((step) => step.agentResponsibility)).toEqual([
      "review",
      "plan",
    ]);
    expect(state.agentResponsibilities).toEqual(["review", "plan"]);
    expect(state.stage).toBe("review");
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
      path: "goals/instances/simple/state.json",
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
        agentResponsibilities: [],
        route: [],
        facts: {},
        blockers: [],
      },
    };

    expect(isStoreBackedManagedGoal(goal)).toBe(true);
  });
});

describe("canDeleteManagedGoal", () => {
  it("allows removing local Store-backed instances", () => {
    const goal: ManagedGoalRecord = {
      id: "codebase-health",
      path: "goals/instances/codebase-health/state.json",
      source: "local",
      recordType: "instance",
      state: {
        version: 1,
        sourceTemplate: "codebase-health",
        state: "active",
        type: "agentLoop",
        destination: {
          outcome: "Keep the codebase healthy.",
          evidence: [],
        },
        agentResponsibilities: ["code-health"],
        route: [],
        facts: {},
        blockers: [],
      },
    };

    expect(canDeleteManagedGoal(goal)).toBe(true);
  });

  it("allows removing Store references from this repo", () => {
    const goal: ManagedGoalRecord = {
      id: "codebase-health",
      path: ".kody/goals/templates/codebase-health/state.json",
      source: "store",
      recordType: "template",
      state: {
        version: 1,
        kind: "template",
        template: true,
        state: "inactive",
        type: "agentLoop",
        destination: {
          outcome: "Keep the codebase healthy.",
          evidence: [],
        },
        agentResponsibilities: ["code-health"],
        route: [],
        facts: {},
        blockers: [],
      },
    };

    expect(canDeleteManagedGoal(goal)).toBe(true);
  });
});

describe("managedGoalModel", () => {
  function goal(
    overrides: Partial<ManagedGoalRecord["state"]>,
  ): ManagedGoalRecord {
    return {
      id: "model-test",
      path: "goals/instances/model-test/state.json",
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
        agentResponsibilities: ["release"],
        route: [
          {
            stage: "release",
            evidence: "releasePrExists",
            agentResponsibility: "release",
          },
        ],
        facts: {},
        blockers: [],
        ...overrides,
      },
    };
  }

  it("classifies routed evidence goals as agentGoals", () => {
    expect(managedGoalModel(goal({ type: "release" }))).toBe("agentGoal");
  });

  it("classifies agentLoop goals as agentLoops", () => {
    expect(
      managedGoalModel(
        goal({
          type: "release",
          scheduleMode: "agentLoop",
        }),
      ),
    ).toBe("agentLoop");
  });

  it("classifies agentLoop and legacy agentLoop types as agentLoops", () => {
    expect(managedGoalModel(goal({ type: "agentLoop" }))).toBe("agentLoop");
    expect(managedGoalModel(goal({ type: "maintain" }))).toBe("agentLoop");
    expect(managedGoalModel(goal({ type: "monitor" }))).toBe("agentLoop");
  });
});

describe("collapseManagedGoalRecordsForList", () => {
  function record(id: string, updatedAt: string): ManagedGoalRecord {
    return {
      id,
      path: `goals/instances/${id}/state.json`,
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
        agentResponsibilities: ["company-graph"],
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
