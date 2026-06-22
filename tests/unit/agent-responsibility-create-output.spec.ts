/**
 * Tests for the agentResponsibility-create output choice. The dialog itself is hook-heavy and
 * the repo does not use a DOM test environment, so pure helpers plus source
 * structure cover the behavior without jsdom.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDefaultAgentResponsibilityBody,
  buildAgentResponsibilityWritesTo,
  defaultReportSlug,
  agentResponsibilityOutputFromWritesTo,
  normalizeReportSlug,
} from "@dashboard/lib/agent-responsibilities/output";

const DUTY_CONTROL_SOURCE = readFileSync(
  "src/dashboard/lib/components/AgentResponsibilityControl.tsx",
  "utf8",
);

function createDialogSource(): string {
  const match = DUTY_CONTROL_SOURCE.match(
    /function CreateAgentResponsibilityDialog[\s\S]*?\nfunction EditAgentResponsibilityDialog/,
  );
  expect(
    match,
    "CreateAgentResponsibilityDialog source should be present",
  ).not.toBeNull();
  return match![0];
}

function editDialogSource(): string {
  const match = DUTY_CONTROL_SOURCE.match(
    /function EditAgentResponsibilityDialog[\s\S]*?\n\/\*\*\n \* Inline "last run"/,
  );
  expect(
    match,
    "EditAgentResponsibilityDialog source should be present",
  ).not.toBeNull();
  return match![0];
}

function agentResponsibilityFormSource(): string {
  const match = DUTY_CONTROL_SOURCE.match(
    /function AgentResponsibilityForm[\s\S]*?\nfunction OutputSelect/,
  );
  expect(
    match,
    "AgentResponsibilityForm source should be present",
  ).not.toBeNull();
  return match![0];
}

describe("agentResponsibility create output choice", () => {
  it("normalizes report slugs from human input", () => {
    expect(normalizeReportSlug(" CI Health Graph ")).toBe("ci-health-graph");
    expect(normalizeReportSlug("bad!!!slug")).toBe("bad-slug");
    expect(defaultReportSlug("repo-graph", "Repo Graph")).toBe("repo-graph");
    expect(defaultReportSlug("", "Weekly QA")).toBe("weekly-qa");
  });

  it("maps output choice to agentResponsibility writesTo metadata", () => {
    expect(buildAgentResponsibilityWritesTo("run", "ci-health")).toEqual([]);
    expect(buildAgentResponsibilityWritesTo("report", "ci-health")).toEqual([
      "ci-health",
    ]);
  });

  it("derives the edit output choice from existing writesTo metadata", () => {
    expect(agentResponsibilityOutputFromWritesTo([])).toEqual({
      outputKind: "run",
      reportSlug: "agentresponsibility-report",
    });
    expect(agentResponsibilityOutputFromWritesTo(["ci-health-graph"])).toEqual({
      outputKind: "report",
      reportSlug: "ci-health-graph",
    });
  });

  it("builds a report body only when report output is selected", () => {
    expect(
      buildDefaultAgentResponsibilityBody("run", "ci-health"),
    ).not.toContain("## Output");
    expect(
      buildDefaultAgentResponsibilityBody("report", "ci-health"),
    ).toContain("Refresh `.kody/reports/ci-health.md`.");
  });

  it("create and edit dialogs use the same agentResponsibility form", () => {
    const source = createDialogSource();
    const editSource = editDialogSource();
    expect(source).toContain("<AgentResponsibilityForm");
    expect(editSource).toContain("<AgentResponsibilityForm");
    expect(
      DUTY_CONTROL_SOURCE.match(/function AgentResponsibilityForm\(/g),
    ).toHaveLength(1);
  });

  it("shared agentResponsibility form exposes output and report target, not an enabled checkbox", () => {
    const source = agentResponsibilityFormSource();
    expect(source).toContain("<OutputSelect");
    expect(source).toContain("Report target");
    expect(source).toContain("<AgentResponsibilityActionScheduleRow");
    expect(source).toContain("<AgentResponsibilityAgentRoleRow");
    expect(source).toContain("<AgentResponsibilityAgentActionOutputRow");
    expect(source).toContain("writesTo: buildAgentResponsibilityWritesTo");
    expect(source).not.toContain("<MentionsInput");
    expect(source).not.toContain("<AgentResponsibilityEnabledCheckbox");
    expect(source).not.toContain("disabled: !enabled");
  });

  it("edit dialog includes output in its initial state and patch", () => {
    const source = editDialogSource();
    expect(source).toContain(
      "agentResponsibilityOutputFromWritesTo(agentResponsibility.writesTo)",
    );
    expect(source).toContain("writesTo");
    expect(source).toContain("outputKind !== initialOutput.outputKind");
  });

  it("does not expose an enabled checkbox anywhere in agentResponsibility forms", () => {
    expect(DUTY_CONTROL_SOURCE).not.toContain(
      "function AgentResponsibilityEnabledCheckbox",
    );
    expect(DUTY_CONTROL_SOURCE).not.toContain(
      "<AgentResponsibilityEnabledCheckbox",
    );
    expect(DUTY_CONTROL_SOURCE).not.toContain(
      'id="agentResponsibility-enabled"',
    );
  });

  it("places agent and reviewer controls in one responsive row", () => {
    expect(DUTY_CONTROL_SOURCE).toContain(
      "function AgentResponsibilityAgentRoleRow",
    );
    expect(DUTY_CONTROL_SOURCE).toContain("md:grid-cols-2");
    expect(DUTY_CONTROL_SOURCE).toContain("<AgentSelect");
    expect(DUTY_CONTROL_SOURCE).toContain("<ReviewerSelect");
  });

  it("places action with schedule and agentAction with output", () => {
    expect(DUTY_CONTROL_SOURCE).toContain(
      "function AgentResponsibilityActionScheduleRow",
    );
    expect(DUTY_CONTROL_SOURCE).toContain("actionId");
    expect(DUTY_CONTROL_SOURCE).toContain("<ScheduleSelect");
    expect(DUTY_CONTROL_SOURCE).toContain(
      "function AgentResponsibilityAgentActionOutputRow",
    );
    expect(DUTY_CONTROL_SOURCE).toContain("<AgentActionSelect");
    expect(DUTY_CONTROL_SOURCE).toContain("<OutputSelect");
    expect(DUTY_CONTROL_SOURCE).not.toContain("function MentionsInput");
  });

  it("uses searchable selects for long agentResponsibility dropdowns", () => {
    expect(DUTY_CONTROL_SOURCE).toContain("SearchableSelect");
    expect(DUTY_CONTROL_SOURCE).toContain('searchPlaceholder="Search agent…"');
    expect(DUTY_CONTROL_SOURCE).toContain(
      'searchPlaceholder="Search agentActions…"',
    );
  });

  it("keeps agentResponsibility dialogs open when Escape closes a searchable dropdown", () => {
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
