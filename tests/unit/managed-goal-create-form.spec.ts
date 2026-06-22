/**
 * @fileoverview Structural regression tests managed model create form.
 * @testFramework vitest
 * @domain goals
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/dashboard/lib/components/ManagedModelsView.tsx",
  "utf8",
);

describe("ManagedModelsView new model form", () => {
  it("keeps objective creation evidence-driven and routine creation cadence-driven", () => {
    const dialog = source.slice(
      source.indexOf("function NewGoalDialog"),
      source.indexOf("function EditManagedGoalDialog"),
    );

    expect(dialog).toContain('const isRoutine = model === "routine"');
    expect(dialog).toContain(
      'const defaultSchedule: ManagedGoalSchedule = isRoutine ? "1d" : "manual"',
    );
    expect(dialog).toContain(
      "const showTypeSelect = !isRoutine && goalTypes.length > 1",
    );
    expect(dialog).toContain(
      "Define the finish line and evidence Kody must close.",
    );
    expect(dialog).toContain(
      '<Label htmlFor="goal-type">Objective type</Label>',
    );
    expect(dialog).toContain("Missing evidence");
    expect(dialog).toContain("selectedGoalType.evidence.map");
    expect(dialog).toContain("selectedGoalType.route.map");
    expect(dialog).toContain('<Label htmlFor="goal-schedule">Cadence</Label>');
    expect(dialog).toContain("Routine loop");
    expect(dialog).toContain("Duties");
    expect(dialog).toContain("availableRoutineDuties.map");
    expect(dialog).toContain("toggleRoutineDuty");
    expect(dialog).toContain("selectedDutySlugs.length");
    expect(dialog).toContain('isRoutine ? "Scope" : "Finish line"');
    expect(dialog).not.toContain("goal-create-mode");
    expect(dialog).not.toContain("New instance");
    expect(dialog).not.toContain("goal-id");
    expect(dialog).not.toContain("Goal preset");
    expect(dialog).not.toContain("Proof key");
    expect(dialog).not.toContain("Proof route");
    expect(dialog).not.toContain("Advanced");
  });

  it("keeps edit away from route proof internals while using model-aware labels", () => {
    const dialog = source.slice(
      source.indexOf("function EditManagedGoalDialog"),
      source.indexOf("function GoalRow"),
    );

    expect(dialog).toContain('isRoutine ? "Routine scope" : "Finish line"');
    expect(dialog).toContain(
      '<Label htmlFor="edit-goal-schedule">Schedule</Label>',
    );
    expect(dialog).not.toContain("Proof key");
    expect(dialog).not.toContain("Proof route");
    expect(dialog).not.toContain("Advanced");
  });
});
