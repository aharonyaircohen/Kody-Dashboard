import { describe, expect, it } from "vitest";

import {
  buildManagedGoalState,
  normalizeManagedGoalState,
} from "@dashboard/lib/managed-goals";
import {
  buildWorkflowDefinition,
  mergeWorkflowDefinition,
  normalizeWorkflowDefinition,
} from "@dashboard/lib/workflow-definitions";

describe("model run without approval flag", () => {
  it("stores the flag on managed goals only when enabled", () => {
    expect(
      buildManagedGoalState({
        type: "improve",
        outcome: "Ship it",
        runWithoutApproval: true,
      }).runWithoutApproval,
    ).toBe(true);

    expect(
      buildManagedGoalState({
        type: "improve",
        outcome: "Ship it",
        runWithoutApproval: false,
      }).runWithoutApproval,
    ).toBeUndefined();
  });

  it("normalizes legacy managed goals as approval-required by default", () => {
    expect(
      normalizeManagedGoalState({
        version: 1,
        state: "active",
        type: "improve",
        destination: { outcome: "Ship it", evidence: ["done"] },
        capabilities: ["fix"],
        route: [{ stage: "fix", evidence: "done", capability: "fix" }],
        facts: {},
        blockers: [],
      })?.runWithoutApproval,
    ).toBeUndefined();
  });

  it("stores and preserves the flag on workflows", () => {
    const workflow = buildWorkflowDefinition({
      name: "QA",
      capabilities: ["qa-goal"],
      runWithoutApproval: true,
    });

    expect(workflow.runWithoutApproval).toBe(true);
    expect(
      mergeWorkflowDefinition(workflow, { name: "QA updated" })
        .runWithoutApproval,
    ).toBe(true);
    expect(
      normalizeWorkflowDefinition({
        version: 1,
        name: "Legacy",
        capabilities: ["qa-goal"],
      })?.runWithoutApproval,
    ).toBeUndefined();
  });

  it("normalizes Store workflow steps as capabilities", () => {
    expect(
      normalizeWorkflowDefinition({
        version: 1,
        name: "Task Delivery",
        steps: [
          { capability: "task-verifier" },
          { capability: "assigned-task-runner" },
        ],
      })?.capabilities,
    ).toEqual(["task-verifier", "assigned-task-runner"]);
  });
});
