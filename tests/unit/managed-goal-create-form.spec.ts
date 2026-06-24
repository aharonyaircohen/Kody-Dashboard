/**
 * @fileoverview Structural regression tests for the managed model dialogs.
 * @testFramework vitest
 * @domain goals
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/dashboard/lib/components/ManagedModelsView.tsx",
  "utf8",
);

describe("ManagedModelsView model form", () => {
  it("keeps agentGoal creation evidence-driven while sharing the agentResponsibilities control", () => {
    const dialog = source.slice(
      source.indexOf("function NewGoalDialog"),
      source.indexOf("function EditManagedGoalDialog"),
    );

    expect(dialog).toContain('const isRoutine = model === "agentLoop"');
    expect(dialog).toContain(
      'const defaultSchedule: ManagedGoalSchedule = isRoutine ? "1d" : "manual"',
    );
    expect(source).toContain('kindLabel: "",');
    expect(source).toContain("{copy.kindLabel ? (");
    expect(dialog).toContain(
      "Define the finish line and attach the agentResponsibilities Kody should use.",
    );
    expect(dialog).toContain("AgentResponsibilities");
    expect(dialog).toContain("SearchableMultiSelect");
    expect(dialog).toContain('id="agentGoal-agentResponsibilities"');
    expect(dialog).toContain("options={agentResponsibilityOptions}");
    expect(dialog).toContain(": selectedAgentResponsibilitySlugs,");
    expect(dialog).toContain("useState<string[]>([])");
    expect(dialog).toContain("if (open) reset();");
    expect(dialog).toContain("setSelectedAgentResponsibilitySlugs([]);");
    expect(dialog).not.toContain(
      "isRoutine ? [] : defaultType.agentResponsibilities",
    );
    expect(dialog).toContain("selectedAgentResponsibilitySlugs.length > 0");
    expect(dialog).toContain("SaveReportCheckbox");
    expect(source).toContain("function PreferredRunTimeFields");
    expect(source).toContain('className="grid min-w-0 grid-cols-2 gap-2"');
    expect(source).toContain("id={`${idPrefix}-preferred-run-at`}");
    expect(source).toContain("id={`${idPrefix}-preferred-run-timezone`}");
    expect(source).toContain('aria-label="Preferred timezone"');
    expect(dialog).toContain('idPrefix="loop"');
    expect(dialog).toContain("time={preferredRunAt}");
    expect(dialog).toContain("timezone={preferredRunTimeZone}");
    expect(dialog).toContain("onTimeChange={updatePreferredRunAt}");
    expect(dialog).toContain("onTimezoneChange={setPreferredRunTimeZone}");
    expect(source).toContain("preferredRunTimeOptions.map");
    expect(source).toContain("timezoneChoices.map");
    expect(dialog).toContain("preferredRunTimeZoneChoices");
    expect(source).not.toContain("<SelectGroup>");
    expect(source).not.toContain("<SelectLabel>Timezone</SelectLabel>");
    expect(source).not.toContain("<SelectLabel>Hour</SelectLabel>");
    expect(source).not.toContain("preferredRunTimeZoneValue(timezone)");
    expect(source).not.toContain("PreferredRunTimeLabel");
    expect(source).not.toContain("PreferredRunTimeValue");
    expect(source).not.toContain('type="time"');
    expect(dialog).toContain(
      "preferredRunTime: isRoutine ? preferredRunTime : undefined",
    );
    expect(dialog).toContain("routeStepsWithReportPreference");
    expect(dialog).not.toContain("ObjectiveEvidenceRouteSummary");
    expect(dialog).not.toContain("Missing evidence");
    expect(dialog).not.toContain("Route setup");
    expect(dialog).not.toContain("AgentGoal type");
    expect(dialog).toContain("<SearchableSelect");
    expect(dialog).not.toContain("ObjectiveTypeSelectedSummary");
    expect(dialog).not.toContain("ObjectiveTypeInfo");
    expect(dialog).not.toContain("goal-create-mode");
    expect(dialog).not.toContain("New instance");
    expect(dialog).not.toContain("goal-id");
    expect(dialog).not.toContain("Goal preset");
    expect(dialog).not.toContain("Proof key");
    expect(dialog).not.toContain("Proof route");
    expect(dialog).not.toContain("Advanced");
  });

  it("keeps non-model flows out of user-facing agentGoal controls", () => {
    const visibleTypeBlock = source.slice(
      source.indexOf("const USER_VISIBLE_OBJECTIVE_TYPE_IDS"),
      source.indexOf("function userVisibleObjectiveGoalTypes"),
    );
    const createDialog = source.slice(
      source.indexOf("function NewGoalDialog"),
      source.indexOf("function EditManagedGoalDialog"),
    );
    const editDialog = source.slice(
      source.indexOf("function EditManagedGoalDialog"),
      source.indexOf("function GoalRow"),
    );

    expect(visibleTypeBlock).toContain('"improve"');
    expect(visibleTypeBlock).not.toContain('"release"');
    expect(visibleTypeBlock).not.toContain('"checklist"');
    expect(createDialog).toContain("userVisibleObjectiveGoalTypes()");
    expect(createDialog).toContain('id="agentGoal-agentResponsibilities"');
    expect(createDialog).toContain('id="loop-target"');
    expect(editDialog).toContain("userVisibleObjectiveGoalTypes()");
    expect(editDialog).toContain("selectedVisibleObjectiveGoalType");
    expect(editDialog).not.toContain("showObjectiveTypeSelect");
    expect(editDialog).toContain('id="edit-agentGoal-agentResponsibilities"');
    expect(editDialog).toContain('id="edit-loop-target"');
  });

  it("keeps agentGoal edits agentResponsibility-driven without exposing type labels", () => {
    const dialog = source.slice(
      source.indexOf("function EditManagedGoalDialog"),
      source.indexOf("function GoalRow"),
    );

    expect(dialog).toContain(
      'const intentLabel = isRoutine ? "Scope" : "Finish line"',
    );
    expect(dialog).toContain(
      "Update the finish line and attached agentResponsibilities.",
    );
    expect(dialog).toContain("const objectiveGoalType =");
    expect(dialog).toContain('"edit-agentGoal-agentResponsibilities"');
    expect(dialog).toContain("options={agentResponsibilityOptions}");
    expect(dialog).toContain(
      "setSelectedAgentResponsibilitySlugs(goal.state.agentResponsibilities)",
    );
    expect(dialog).toContain("mergeOrderedSlugs(current, next)");
    expect(dialog).toContain("moveSelectedAgentResponsibility");
    expect(dialog).toContain(
      "agentResponsibilities: selectedAgentResponsibilitySlugs",
    );
    expect(dialog).toContain("evidence: evidenceForRoute(routeSteps)");
    expect(dialog).toContain("route: routeWithReportPreference");
    expect(dialog).toContain(
      "setSaveReport(routeSavesReport(goal.state.route))",
    );
    expect(dialog).toContain("OrderedPathSection");
    expect(dialog).not.toContain("ObjectiveEvidenceRouteSummary");
    expect(dialog).not.toContain("AgentGoal type");
    expect(dialog).not.toContain("setEditGoalType");
    expect(dialog).not.toContain("objectiveGoalTypeOptions");
    expect(dialog).not.toContain("ObjectiveTypeSelectedSummary");
    expect(dialog).not.toContain("ObjectiveTypeInfo");
    expect(dialog).not.toContain('<SelectTrigger id="edit-goal-type">');
    expect(dialog).not.toContain('{isRoutine ? "Cadence" : "Schedule"}');
    expect(dialog).not.toContain("Proof key");
    expect(dialog).not.toContain("Proof route");
    expect(dialog).not.toContain("Advanced");
  });

  it("uses the same selected agentResponsibility tag picker for agentLoop edits", () => {
    const dialog = source.slice(
      source.indexOf("function EditManagedGoalDialog"),
      source.indexOf("function GoalRow"),
    );

    expect(dialog).toContain(
      'const intentLabel = isRoutine ? "Scope" : "Finish line"',
    );
    expect(dialog).toContain("agentResponsibilitySelectOptions(");
    expect(dialog).toContain("goal?.state.agentResponsibilities ?? []");
    expect(dialog).toContain("SearchableMultiSelect");
    expect(dialog).toContain("selectedAgentResponsibilitySlugs.length > 0");
    expect(dialog).toContain('loopTarget?.type === "agentResponsibility"');
    expect(dialog).toContain("saveReport");
    expect(dialog).toContain(
      'selectedHeading="Selected agentResponsibilities"',
    );
    expect(dialog).toContain('selectedTone="info"');
    expect(dialog).toContain('idPrefix="edit-loop"');
    expect(source).toContain('className="grid min-w-0 grid-cols-2 gap-2"');
    expect(dialog).toContain("time={preferredRunAt}");
    expect(dialog).toContain("timezone={preferredRunTimeZone}");
    expect(dialog).toContain("onTimeChange={updatePreferredRunAt}");
    expect(dialog).toContain("onTimezoneChange={setPreferredRunTimeZone}");
    expect(source).toContain("preferredRunTimeOptions.map");
    expect(source).toContain("timezoneChoices.map");
    expect(dialog).toContain("preferredRunTimeZoneChoices");
    expect(source).not.toContain("<SelectGroup>");
    expect(source).not.toContain("<SelectLabel>Timezone</SelectLabel>");
    expect(source).not.toContain("<SelectLabel>Hour</SelectLabel>");
    expect(source).not.toContain("preferredRunTimeZoneValue(timezone)");
    expect(source).not.toContain("PreferredRunTimeLabel");
    expect(source).not.toContain("PreferredRunTimeValue");
    expect(source).not.toContain('type="time"');
    expect(dialog).toContain("preferredRunTime: preferredRunTime ?? null");
    expect(dialog).toContain("md:col-span-2");
  });
});
