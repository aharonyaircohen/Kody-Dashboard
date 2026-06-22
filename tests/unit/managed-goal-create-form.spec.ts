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
    expect(source).toContain("Missing evidence");
    expect(source).toContain("goalType.evidence.map");
    expect(source).toContain("goalType.route.map");
    expect(dialog).toContain('<Label htmlFor="goal-schedule">Cadence</Label>');
    expect(dialog).not.toContain("Routine loop");
    expect(dialog).toContain("Duties");
    expect(dialog).toContain("SearchableMultiSelect");
    expect(dialog).toContain("options={routineDutyOptions}");
    expect(source).toContain("function compactDutyLabel");
    expect(source).toContain("selectedLabel: compactDutyLabel(duty.slug)");
    expect(dialog).toContain("isRoutine ? [] : defaultType.duties");
    expect(dialog).not.toContain(
      "setSelectedDutySlugs(selectedGoalType.duties)",
    );
    expect(dialog).toContain('selectedLabel="duties selected"');
    expect(dialog).toContain('selectedSingularLabel="duty selected"');
    expect(dialog).toContain('selectedHeading="Selected duties"');
    expect(dialog).toContain('selectedTone="info"');
    expect(dialog).toContain("md:col-span-2");
    expect(dialog).toContain("selectedDutySlugs.length");
    expect(dialog).toContain('isRoutine ? "Scope" : "Finish line"');
    expect(dialog.indexOf('htmlFor="goal-outcome"')).toBeLessThan(
      dialog.indexOf('className="grid min-w-0 gap-3 md:grid-cols-2"'),
    );
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

    expect(dialog).toContain(
      'const intentLabel = isRoutine ? "Scope" : "Finish line"',
    );
    expect(dialog).toContain(
      "Update objective finish line and evidence route.",
    );
    expect(dialog).toContain("const objectiveGoalType =");
    expect(dialog).toContain("<Label>Objective type</Label>");
    expect(dialog).toContain(
      "<ObjectiveTypeInfo goalType={objectiveGoalType} />",
    );
    expect(dialog).toContain(
      "<ObjectiveEvidenceRouteSummary goalType={objectiveGoalType} />",
    );
    expect(dialog.indexOf('htmlFor="edit-goal-outcome"')).toBeLessThan(
      dialog.indexOf('className="grid min-w-0 gap-3 md:grid-cols-2"'),
    );
    expect(dialog).not.toContain('{isRoutine ? "Cadence" : "Schedule"}');
    expect(dialog).not.toContain("Proof key");
    expect(dialog).not.toContain("Proof route");
    expect(dialog).not.toContain("Advanced");
  });

  it("uses the same duty picker shape for routine edits", () => {
    const dialog = source.slice(
      source.indexOf("function EditManagedGoalDialog"),
      source.indexOf("function GoalRow"),
    );

    expect(dialog).toContain(
      'const intentLabel = isRoutine ? "Scope" : "Finish line"',
    );
    expect(dialog).toContain(
      "dutySelectOptions(duties, goal?.state.duties ?? [])",
    );
    expect(dialog).toContain(
      '<Label htmlFor="edit-routine-duties">Duties</Label>',
    );
    expect(dialog).toContain("SearchableMultiSelect");
    expect(dialog).toContain("selectedDutySlugs.length");
    expect(dialog).toContain(
      "...(isRoutine ? { duties: selectedDutySlugs } : {})",
    );
    expect(dialog).toContain("md:col-span-2");
  });
});
