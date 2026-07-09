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
  mergeManagedGoalStateWithTemplate,
  isManagedGoalState,
  managedGoalModel,
  managedGoalPath,
  normalizeManagedGoalState,
  type ManagedGoalRecord,
} from "../../src/dashboard/lib/managed-goals";

describe("managedGoalPath", () => {
  it("points managed state to the todo list file", () => {
    expect(managedGoalPath("simple-rollout")).toBe("todos/simple-rollout.json");
  });
});

describe("goalStatePath", () => {
  it("points Tasks-page goals to the todo list file", () => {
    expect(goalStatePath("legacy-dashboard-goal")).toBe(
      "todos/legacy-dashboard-goal.json",
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
        capabilities: ["vercel-production-deploy"],
        route: [],
        facts: {},
        blockers: [],
      }),
    ).toBe(true);
  });
});

describe("normalizeManagedGoalState", () => {
  it("normalizes engine-written null capabilities from route", () => {
    const state = normalizeManagedGoalState({
      version: 1,
      state: "active",
      type: "improve",
      destination: {
        outcome: "Goal creation works.",
        evidence: ["planReady"],
      },
      capabilities: null,
      route: [
        {
          stage: "plan",
          evidence: "planReady",
          capability: "plan",
        },
      ],
      facts: {},
      blockers: [],
    });

    expect(state?.capabilities).toEqual(["plan"]);
    expect(state?.route[0]?.stage).toBe("plan");
  });

  it("accepts legacy capability goal state as capabilities", () => {
    const state = normalizeManagedGoalState({
      version: 1,
      state: "active",
      type: "routine",
      destination: {
        outcome: "Refresh company graph report.",
        evidence: ["companyGraphRefreshed"],
      },
      schedule: "1h",
      scheduleMode: "capability-cadence",
      capabilities: ["company-graph"],
      route: [
        {
          stage: "refresh-company-graph",
          evidence: "companyGraphRefreshed",
          capability: "company-graph",
          implementation: "company-graph",
          args: { goal: { fact: "goalId" } },
        },
      ],
      facts: {},
      blockers: [],
    });

    expect(state).not.toBeNull();
    expect(state).toMatchObject({
      capabilities: ["company-graph"],
      route: [
        {
          stage: "refresh-company-graph",
          evidence: "companyGraphRefreshed",
          capability: "company-graph",
        },
      ],
    });
    expect(
      managedGoalModel({
        id: "legacy-loop",
        path: "todos/legacy-loop.json",
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
      capabilities: ["release", "release-merge", "vercel-production-deploy"],
      route: [
        {
          stage: "release",
          evidence: "releasePrExists",
          capability: "release",
        },
        {
          stage: "merge",
          evidence: "mainMerged",
          capability: "release-merge",
        },
        {
          stage: "publish",
          evidence: "productionDeployed",
          capability: "vercel-production-deploy",
        },
      ],
      facts: {},
      blockers: [],
    });

    expect(state).not.toBeNull();
    expect(state?.capabilities).toEqual([
      "release-prepare",
      "release-merge",
      "vercel-production-deploy",
    ]);
    expect(state?.route.map((step) => step.capability)).toEqual([
      "release-prepare",
      "release-merge",
      "vercel-production-deploy",
    ]);
  });
});

describe("mergeManagedGoalStateWithTemplate", () => {
  it("uses Store-owned fields for template-backed runtime state", () => {
    const runtime = normalizeManagedGoalState({
      version: 1,
      state: "active",
      type: "monitor",
      sourceTemplate: "ai-agency-health",
      destination: { outcome: "Old copied state", evidence: [] },
      capabilities: [],
      route: [],
      schedule: "1d",
      scheduleMode: "agentLoop",
      facts: { "ai-agency-health-matrix": true },
      blockers: [],
    });
    const template = normalizeManagedGoalState({
      version: 1,
      kind: "template",
      template: true,
      templateId: "ai-agency-health",
      state: "inactive",
      type: "monitor",
      destination: {
        outcome: "AI Agency stays healthy.",
        evidence: ["ai-agency-health-matrix"],
      },
      capabilities: ["ai-agency-health-matrix"],
      route: [],
      schedule: "15m",
      scheduleMode: "agentLoop",
      facts: { "ai-agency-health-matrix": false },
      blockers: [],
    });

    expect(runtime).not.toBeNull();
    expect(template).not.toBeNull();

    const merged = mergeManagedGoalStateWithTemplate(runtime!, template!);

    expect(merged.schedule).toBe("15m");
    expect(merged.destination.outcome).toBe("AI Agency stays healthy.");
    expect(merged.capabilities).toEqual(["ai-agency-health-matrix"]);
    expect(merged.facts["ai-agency-health-matrix"]).toBe(true);
  });

  it("preserves Store workflow targets for workflow-backed templates", () => {
    const runtime = normalizeManagedGoalState({
      version: 1,
      state: "active",
      type: "web-release",
      sourceTemplate: "web-release",
      destination: { outcome: "Old release state", evidence: [] },
      capabilities: ["release-prepare"],
      route: [
        {
          stage: "release",
          evidence: "releasePrExists",
          capability: "release-prepare",
        },
      ],
      facts: {},
      blockers: [],
    });
    const template = normalizeManagedGoalState({
      version: 1,
      kind: "template",
      template: true,
      templateId: "web-release",
      state: "inactive",
      type: "web-release",
      destination: {
        outcome: "Release is prepared and verified on production.",
        evidence: ["releasePrExists", "productionDeployed"],
      },
      workflowRef: { id: "web-release", source: "store" },
      capabilities: [],
      route: [],
      stage: "workflow",
      facts: {},
      blockers: [],
    });

    expect(runtime).not.toBeNull();
    expect(template).not.toBeNull();

    const merged = mergeManagedGoalStateWithTemplate(runtime!, template!);

    expect(merged.workflowRef).toEqual({ id: "web-release", source: "store" });
    expect(merged.capabilities).toEqual([]);
    expect(merged.route).toEqual([]);
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
      capabilities: [
        "release-prepare",
        "task-leader",
        "vercel-production-deploy",
      ],
      route: [
        {
          stage: "release",
          evidence: "releasePrExists",
          capability: "release-prepare",
        },
        {
          stage: "merge",
          evidence: "mainMerged",
          capability: "task-leader",
        },
        {
          stage: "publish",
          evidence: "productionDeployed",
          capability: "vercel-production-deploy",
        },
      ],
      facts: {
        goalType: "release",
      },
    });
  });

  it("builds a workflow-backed goal without copying workflow capabilities", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "improve",
        schedule: "manual",
        prompt: "Ship the web release.",
        workflowRef: { id: "web-release", source: "store" },
        capabilities: [],
        evidence: [],
        route: [],
      }),
    );

    expect(state).toMatchObject({
      type: "improve",
      schedule: "manual",
      destination: {
        outcome: "Ship the web release.",
        evidence: [],
      },
      workflowRef: { id: "web-release", source: "store" },
      capabilities: [],
      route: [],
      facts: { goalType: "improve" },
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
    expect(state.capabilities).toEqual([]);
  });

  it("uses capability target creating agentLoop", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "agentLoop",
        schedule: "1d",
        prompt: "Keep docs healthy.",
        loopTarget: { type: "capability", id: "docs-health" },
      }),
    );

    expect(state.loopTarget).toEqual({
      type: "capability",
      id: "docs-health",
    });
    expect(state.capabilities).toEqual(["docs-health"]);
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
    expect(state.capabilities).toEqual([]);
    expect(state.scheduleMode).toBe("agentLoop");
  });

  it("uses workflow target creating agentLoop", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "agentLoop",
        schedule: "1d",
        prompt: "Run release hygiene every day.",
        loopTarget: { type: "workflow", id: "release-hygiene" },
      }),
    );

    expect(state.loopTarget).toEqual({
      type: "workflow",
      id: "release-hygiene",
    });
    expect(state.capabilities).toEqual([]);
    expect(state.scheduleMode).toBe("agentLoop");
  });

  it("normalizes workflow target schedule decisions", () => {
    const state = normalizeManagedGoalState({
      version: 1,
      state: "active",
      type: "agentLoop",
      scheduleMode: "agentLoop",
      destination: {
        outcome: "Run release hygiene every day.",
        evidence: [],
      },
      capabilities: [],
      route: [],
      loopTarget: { type: "workflow", id: "release-hygiene" },
      scheduleState: {
        mode: "agentLoop",
        lastGoalTickAt: "2026-06-27T06:00:00Z",
        lastDecision: {
          kind: "dispatch",
          targetType: "workflow",
          targetId: "release-hygiene",
          action: "release-hygiene",
          capability: "release-hygiene",
          reason: "ready target loop tick",
          at: "2026-06-27T06:00:00Z",
        },
        capabilities: {},
      },
      facts: {},
      blockers: [],
    });

    expect(state?.loopTarget).toEqual({
      type: "workflow",
      id: "release-hygiene",
    });
    expect(state?.scheduleState?.lastDecision).toMatchObject({
      kind: "dispatch",
      targetType: "workflow",
      targetId: "release-hygiene",
      capability: "release-hygiene",
    });
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

  it("keeps selected capabilities when creating a legacy agentLoop", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "agentLoop",
        schedule: "1d",
        prompt: "Keep docs healthy.",
        capabilities: ["docs-health", "qa-sweep"],
      }),
    );

    expect(state.capabilities).toEqual(["docs-health", "qa-sweep"]);
    expect(state.scheduleMode).toBe("agentLoop");
  });

  it("preserves user-managed route order for agentGoal creation", () => {
    const state = buildManagedGoalState(
      buildSimpleManagedGoalCreateInput({
        goalType: "improve",
        schedule: "manual",
        prompt: "Make goal creation predictable.",
        capabilities: ["review", "plan"],
        evidence: ["changeVerified", "planReady"],
        route: [
          {
            stage: "review",
            evidence: "changeVerified",
            capability: "review",
          },
          {
            stage: "plan",
            evidence: "planReady",
            capability: "plan",
          },
        ],
      }),
    );

    expect(state.destination.evidence).toEqual(["changeVerified", "planReady"]);
    expect(state.route.map((step) => step.capability)).toEqual([
      "review",
      "plan",
    ]);
    expect(state.capabilities).toEqual(["review", "plan"]);
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
      path: "todos/simple.json",
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
        capabilities: [],
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
      path: "todos/codebase-health.json",
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
        capabilities: ["code-health"],
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
        capabilities: ["code-health"],
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
      path: "todos/model-test.json",
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
        capabilities: ["release"],
        route: [
          {
            stage: "release",
            evidence: "releasePrExists",
            capability: "release",
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
      path: `todos/${id}.json`,
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
        capabilities: ["company-graph"],
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
