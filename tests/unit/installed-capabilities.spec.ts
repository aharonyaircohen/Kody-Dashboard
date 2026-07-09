/**
 * @fileoverview Unit tests for Store installed capability resolution.
 * @testFramework vitest
 * @domain company-store
 */
import { describe, expect, it } from "vitest";

import {
  capabilitySlugsFromGoalState,
  workflowSlugsFromGoalState,
} from "@dashboard/lib/company-store/installed-capabilities";
import type { ManagedGoalState } from "@dashboard/lib/managed-goals";

function goalState(
  overrides: Partial<ManagedGoalState> = {},
): ManagedGoalState {
  return {
    version: 1,
    state: "inactive",
    type: "maintain",
    destination: { outcome: "Keep healthy", evidence: [] },
    capabilities: [],
    route: [],
    facts: {},
    blockers: [],
    ...overrides,
  };
}

describe("Store installed capability extraction", () => {
  it("reads capabilities directly and from goal routes", () => {
    expect(
      capabilitySlugsFromGoalState(
        goalState({
          capabilities: ["dev-ci-health"],
          route: [
            {
              stage: "review",
              evidence: "reviewed",
              capability: "review",
            },
          ],
          loopTarget: { type: "capability", id: "health-check" },
        }),
      ),
    ).toEqual(["dev-ci-health", "review", "health-check"]);
  });

  it("reads workflows referenced by Store goals", () => {
    expect(
      workflowSlugsFromGoalState(
        goalState({
          workflowRef: { id: "web-release", source: "store" },
          loopTarget: { type: "workflow", id: "task-delivery" },
        }),
      ),
    ).toEqual(["web-release", "task-delivery"]);
  });
});
