import { describe, expect, it } from "vitest";

import {
  managedModelCapabilitySlugs,
  runModeForCapabilities,
  uniqueCapabilitySlugs,
  workflowCapabilitySlugs,
} from "@dashboard/lib/cto/run-mode";
import type { ManagedGoalRecord } from "@dashboard/lib/managed-goals";
import type { WorkflowDefinitionRecord } from "@dashboard/lib/workflow-definitions";

describe("run mode", () => {
  it("uses Auto only when every nested capability is auto", () => {
    expect(
      runModeForCapabilities(
        [
          { capability: "ci-health", mode: "auto" },
          { capability: "review", mode: "ask" },
        ],
        ["ci-health"],
      ),
    ).toBe("auto");

    expect(
      runModeForCapabilities(
        [
          { capability: "ci-health", mode: "auto" },
          { capability: "review", mode: "ask" },
        ],
        ["ci-health", "review"],
      ),
    ).toBe("manual");
  });

  it("dedupes capability slugs", () => {
    expect(uniqueCapabilitySlugs([" ci-health ", "", "ci-health"])).toEqual([
      "ci-health",
    ]);
  });

  it("reads workflow capabilities", () => {
    expect(
      workflowCapabilitySlugs(workflow("dev-ci", ["ci-health", "review"])),
    ).toEqual(["ci-health", "review"]);
  });

  it("reads goal capabilities and route capabilities", () => {
    expect(
      managedModelCapabilitySlugs(
        goal("quality", {
          capabilities: ["ci-health"],
          route: [{ stage: "review", evidence: "checked", capability: "qa" }],
        }),
        [],
        [],
      ),
    ).toEqual(["ci-health", "qa"]);
  });

  it("reads schedule capability state", () => {
    expect(
      managedModelCapabilitySlugs(
        goal("daily-web-release-loop", {
          scheduleMode: "agentLoop",
          loopTarget: { type: "goal", id: "web-release" },
          scheduleState: scheduleState(["release-prepare", "task-leader"]),
        }),
        [],
        [],
      ),
    ).toEqual(["release-prepare", "task-leader"]);
  });

  it("cascades loop mode through capability, goal, and workflow targets", () => {
    const targetGoal = goal("target-goal", { capabilities: ["goal-cap"] });
    const targetWorkflow = workflow("target-workflow", ["workflow-cap"]);

    expect(
      managedModelCapabilitySlugs(
        goal("cap-loop", {
          scheduleMode: "agentLoop",
          loopTarget: { type: "capability", id: "direct-cap" },
        }),
        [targetGoal],
        [targetWorkflow],
      ),
    ).toEqual(["direct-cap"]);

    expect(
      managedModelCapabilitySlugs(
        goal("goal-loop", {
          scheduleMode: "agentLoop",
          loopTarget: { type: "goal", id: "target-goal" },
        }),
        [targetGoal],
        [targetWorkflow],
      ),
    ).toEqual(["goal-cap"]);

    expect(
      managedModelCapabilitySlugs(
        goal("workflow-loop", {
          scheduleMode: "agentLoop",
          loopTarget: { type: "workflow", id: "target-workflow" },
        }),
        [targetGoal],
        [targetWorkflow],
      ),
    ).toEqual(["workflow-cap"]);
  });
});

function goal(
  id: string,
  state: Partial<ManagedGoalRecord["state"]> = {},
): ManagedGoalRecord {
  return {
    id,
    path: `todos/${id}.json`,
    state: {
      version: 1,
      state: "active",
      type: "improve",
      destination: { outcome: id, evidence: [] },
      capabilities: [],
      route: [],
      facts: {},
      blockers: [],
      ...state,
    },
  };
}

function scheduleState(
  capabilities: string[],
): ManagedGoalRecord["state"]["scheduleState"] {
  return {
    mode: "agentLoop",
    lastGoalTickAt: "2026-07-03T00:00:00.000Z",
    lastDecision: {
      kind: "idle",
      reason: "waiting",
      at: "2026-07-03T00:00:00.000Z",
    },
    capabilities: Object.fromEntries(
      capabilities.map((slug) => [
        slug,
        {
          slug,
          state: "waiting",
          reason: "waiting",
        },
      ]),
    ),
  };
}

function workflow(
  id: string,
  capabilities: string[],
): WorkflowDefinitionRecord {
  return {
    id,
    path: `workflows/${id}.json`,
    workflow: {
      version: 1,
      name: id,
      capabilities,
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
    },
  };
}
