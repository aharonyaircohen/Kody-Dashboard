/**
 * Tests for the duty-create output choice. The dialog itself is hook-heavy and
 * the repo does not use a DOM test environment, so pure helpers plus source
 * structure cover the behavior without jsdom.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDefaultDutyBody,
  buildDutyWritesTo,
  defaultReportSlug,
  dutyOutputFromWritesTo,
  normalizeReportSlug,
} from "@dashboard/lib/duties/output";

const DUTY_CONTROL_SOURCE = readFileSync(
  "src/dashboard/lib/components/DutyControl.tsx",
  "utf8",
);

function createDialogSource(): string {
  const match = DUTY_CONTROL_SOURCE.match(
    /function CreateDutyDialog[\s\S]*?\nfunction EditDutyDialog/,
  );
  expect(match, "CreateDutyDialog source should be present").not.toBeNull();
  return match![0];
}

function editDialogSource(): string {
  const match = DUTY_CONTROL_SOURCE.match(
    /function EditDutyDialog[\s\S]*?\n\/\*\*\n \* Inline "last run"/,
  );
  expect(match, "EditDutyDialog source should be present").not.toBeNull();
  return match![0];
}

function dutyFormSource(): string {
  const match = DUTY_CONTROL_SOURCE.match(
    /function DutyForm[\s\S]*?\nfunction OutputSelect/,
  );
  expect(match, "DutyForm source should be present").not.toBeNull();
  return match![0];
}

describe("duty create output choice", () => {
  it("normalizes report slugs from human input", () => {
    expect(normalizeReportSlug(" CI Health Graph ")).toBe("ci-health-graph");
    expect(normalizeReportSlug("bad!!!slug")).toBe("bad-slug");
    expect(defaultReportSlug("repo-graph", "Repo Graph")).toBe("repo-graph");
    expect(defaultReportSlug("", "Weekly QA")).toBe("weekly-qa");
  });

  it("maps output choice to duty writesTo metadata", () => {
    expect(buildDutyWritesTo("run", "ci-health")).toEqual([]);
    expect(buildDutyWritesTo("report", "ci-health")).toEqual(["ci-health"]);
  });

  it("derives the edit output choice from existing writesTo metadata", () => {
    expect(dutyOutputFromWritesTo([])).toEqual({
      outputKind: "run",
      reportSlug: "duty-report",
    });
    expect(dutyOutputFromWritesTo(["ci-health-graph"])).toEqual({
      outputKind: "report",
      reportSlug: "ci-health-graph",
    });
  });

  it("builds a report body only when report output is selected", () => {
    expect(buildDefaultDutyBody("run", "ci-health")).not.toContain("## Output");
    expect(buildDefaultDutyBody("report", "ci-health")).toContain(
      "Refresh `.kody/reports/ci-health.md`.",
    );
  });

  it("create and edit dialogs use the same duty form", () => {
    const source = createDialogSource();
    const editSource = editDialogSource();
    expect(source).toContain("<DutyForm");
    expect(editSource).toContain("<DutyForm");
    expect(DUTY_CONTROL_SOURCE.match(/function DutyForm\(/g)).toHaveLength(1);
  });

  it("shared duty form exposes output and report target, not an enabled checkbox", () => {
    const source = dutyFormSource();
    expect(source).toContain("<OutputSelect");
    expect(source).toContain("Report target");
    expect(source).toContain("<DutyActionScheduleRow");
    expect(source).toContain("<DutyStaffRoleRow");
    expect(source).toContain("<DutyExecutableOutputRow");
    expect(source).toContain("writesTo: buildDutyWritesTo");
    expect(source).not.toContain("<MentionsInput");
    expect(source).not.toContain("<DutyEnabledCheckbox");
    expect(source).not.toContain("disabled: !enabled");
  });

  it("edit dialog includes output in its initial state and patch", () => {
    const source = editDialogSource();
    expect(source).toContain("dutyOutputFromWritesTo(duty.writesTo)");
    expect(source).toContain("writesTo");
    expect(source).toContain("outputKind !== initialOutput.outputKind");
  });

  it("does not expose an enabled checkbox anywhere in duty forms", () => {
    expect(DUTY_CONTROL_SOURCE).not.toContain("function DutyEnabledCheckbox");
    expect(DUTY_CONTROL_SOURCE).not.toContain("<DutyEnabledCheckbox");
    expect(DUTY_CONTROL_SOURCE).not.toContain('id="duty-enabled"');
  });

  it("places runner and reviewer controls in one responsive row", () => {
    expect(DUTY_CONTROL_SOURCE).toContain("function DutyStaffRoleRow");
    expect(DUTY_CONTROL_SOURCE).toContain("md:grid-cols-2");
    expect(DUTY_CONTROL_SOURCE).toContain("<RunnerSelect");
    expect(DUTY_CONTROL_SOURCE).toContain("<ReviewerSelect");
  });

  it("places action with schedule and executable with output", () => {
    expect(DUTY_CONTROL_SOURCE).toContain("function DutyActionScheduleRow");
    expect(DUTY_CONTROL_SOURCE).toContain("actionId");
    expect(DUTY_CONTROL_SOURCE).toContain("<ScheduleSelect");
    expect(DUTY_CONTROL_SOURCE).toContain("function DutyExecutableOutputRow");
    expect(DUTY_CONTROL_SOURCE).toContain("<ExecutableSelect");
    expect(DUTY_CONTROL_SOURCE).toContain("<OutputSelect");
    expect(DUTY_CONTROL_SOURCE).not.toContain("function MentionsInput");
  });

  it("uses searchable selects for long duty dropdowns", () => {
    expect(DUTY_CONTROL_SOURCE).toContain("SearchableSelect");
    expect(DUTY_CONTROL_SOURCE).toContain('searchPlaceholder="Search staff…"');
    expect(DUTY_CONTROL_SOURCE).toContain(
      'searchPlaceholder="Search executables…"',
    );
    expect(DUTY_CONTROL_SOURCE).toContain(
      'searchPlaceholder="Search runners…"',
    );
  });

  it("keeps duty dialogs open when Escape closes a searchable dropdown", () => {
    expect(DUTY_CONTROL_SOURCE).toContain(
      "preventDialogEscapeWhenSearchableSelectOpen",
    );
    expect(DUTY_CONTROL_SOURCE).toContain(
      "querySelector('[data-searchable-select-open=\"true\"]')",
    );
    expect(DUTY_CONTROL_SOURCE).toContain(
      "onEscapeKeyDown={preventDialogEscapeWhenSearchableSelectOpen}",
    );
  });
});
