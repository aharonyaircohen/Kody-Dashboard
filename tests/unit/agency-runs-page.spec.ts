import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  agencyRunDiagnosis,
  formatRunEvidenceLine,
  operatorHappenedLines,
  operatorRunFactLines,
  runEvidenceViewTarget,
  shouldWaitForRunStory,
} from "../../src/dashboard/lib/components/AgencyRunsPage";
import type { AgencyRunSummary } from "../../src/dashboard/lib/agency-runs";

const pageSource = readFileSync(
  "src/dashboard/lib/components/AgencyRunsPage.tsx",
  "utf8",
);
const navSource = readFileSync(
  "src/dashboard/lib/components/settings-nav.ts",
  "utf8",
);

describe("Agency Runs page", () => {
  it("only exposes user-owned agency run tabs", () => {
    expect(pageSource).toContain('label: "Goals"');
    expect(pageSource).toContain('label: "Loops"');
    expect(pageSource).toContain('label: "Workflows"');
    expect(pageSource).not.toContain('label: "All"');
    expect(pageSource).not.toContain('label: "Capabilities"');
  });

  it("is linked from AI Agency navigation", () => {
    expect(navSource).toContain('href: "/agency-runs"');
    expect(navSource).toContain('label: "Agency Runs"');
    expect(navSource).toContain("Kody runs for goals, loops, and workflows.");
  });

  it("opens run details with run story before raw events", () => {
    const diagnosisIndex = pageSource.indexOf("Diagnosis");
    const happenedIndex = pageSource.indexOf("What happened");
    const nextIndex = pageSource.indexOf("Next state");
    const rawIndex = pageSource.indexOf("Raw event timeline");
    const evidenceIndex = pageSource.indexOf("Run evidence");

    expect(pageSource).toContain("function operatorHappened");
    expect(pageSource).toContain("function operatorNext");
    expect(pageSource).toContain("Diagnosis");
    expect(pageSource).toContain("What happened");
    expect(pageSource).toContain("Run evidence");
    expect(pageSource).toContain("Next state");
    expect(pageSource).toContain("Raw event timeline");
    expect(pageSource).not.toContain(">Outcome<");
    expect(diagnosisIndex).toBeGreaterThan(-1);
    expect(happenedIndex).toBeGreaterThan(-1);
    expect(diagnosisIndex).toBeLessThan(happenedIndex);
    expect(nextIndex).toBeGreaterThan(happenedIndex);
    expect(rawIndex).toBeGreaterThan(nextIndex);
    expect(evidenceIndex).toBeGreaterThan(rawIndex);
  });

  it("expands dispatch-only summaries into useful run facts", () => {
    const run: AgencyRunSummary = {
      id: "run-1",
      kind: "goal",
      targetId: "web-release-2026-07-06",
      targetLabel: "web-release-2026-07-06",
      targetModel: "managed-goal",
      origin: "scheduled",
      status: "running",
      title: "Daily web release",
      summary: "dispatch goal web-release-2026-07-06",
      currentStep: "dispatch goal web-release-2026-07-06",
      decision: null,
      startedAt: "2026-07-06T06:00:00.000Z",
      updatedAt: "2026-07-06T06:01:00.000Z",
      durationMs: 61_000,
      kodyRunId: "kody-run-1",
      githubRunId: "123456",
      githubRunUrl: "https://github.com/test/repo/actions/runs/123456",
      logUrl: null,
      statePath: "todos/web-release-2026-07-06.json",
      sourcePath: "logs/goals/web-release-2026-07-06/runs/run.jsonl",
      action: "run",
      capability: "web-release",
      workflow: null,
      implementation: "goal-manager",
      agent: "kody",
      model: "claude/claude-sonnet-4-5",
      modelProvider: "anthropic",
      modelName: "Claude Sonnet 4.5",
      reasoningEffort: null,
      actor: "scheduler",
    };

    const lines = operatorHappenedLines(run, [], null, []);

    expect(lines).toContain("Goal: web-release-2026-07-06.");
    expect(lines).toContain("Status: Running.");
    expect(lines).toContain("Trigger: scheduled.");
    expect(lines).toContain("Runtime: goal-manager.");
    expect(lines).toContain("Model: Claude Sonnet 4.5 (claude/claude-sonnet-4-5).");
    expect(lines.join("\n")).not.toContain("dispatch goal web-release-2026-07-06");
    expect(operatorRunFactLines(run)).toEqual(lines);
  });

  it("formats run evidence without changing the evidence string", () => {
    const field = "GitHub run URL: https://github.com/test/repo/actions/runs/123456";
    const raw =
      'Raw boundary eval: KODY_AGENCY_BOUNDARY_EVAL={"version":1,"status":"pass"}';

    expect(formatRunEvidenceLine(field)).toEqual({
      raw: field,
      label: "GitHub run URL",
      value: "https://github.com/test/repo/actions/runs/123456",
      tone: "field",
    });
    expect(formatRunEvidenceLine(raw)).toEqual({
      raw,
      label: "Raw boundary eval",
      value: 'KODY_AGENCY_BOUNDARY_EVAL={"version":1,"status":"pass"}',
      tone: "raw",
    });
    expect(formatRunEvidenceLine("No source log")).toEqual({
      raw: "No source log",
      label: null,
      value: "No source log",
      tone: "plain",
    });
  });

  it("builds view targets for evidence file references", () => {
    const context = {
      currentRepo: { owner: "A-Guy-educ", repo: "A-Guy-Web" },
      stateRepo: { owner: "A-Guy-educ", repo: "kody-state" },
      stateRef: "main",
    };

    expect(runEvidenceViewTarget("Changed file: src/app/page.tsx", context)).toEqual({
      href: "/files/src/app/page.tsx",
      external: false,
      label: "View file",
    });
    expect(
      runEvidenceViewTarget(
        "Report file: A-Guy-Web/reports/ai-agency-health/runs/latest.md",
        context,
      ),
    ).toEqual({
      href: "/state-files/reports/ai-agency-health/runs/latest.md",
      external: false,
      label: "View state file",
    });
    expect(
      runEvidenceViewTarget("Source log: logs/goals/ci-health/runs/run.jsonl", context),
    ).toEqual({
      href: "/state-files/logs/goals/ci-health/runs/run.jsonl",
      external: false,
      label: "View state file",
    });
    expect(
      runEvidenceViewTarget(
        "GitHub run URL: https://github.com/test/repo/actions/runs/123456",
        context,
      ),
    ).toEqual({
      href: "https://github.com/test/repo/actions/runs/123456",
      external: true,
      label: "Open reference",
    });
  });

  it("diagnoses a stuck handoff without hiding the raw evidence", () => {
    const run: AgencyRunSummary = {
      id: "run-1",
      kind: "loop",
      targetId: "ci-health",
      targetLabel: "ci-health",
      targetModel: "loop",
      origin: "manual",
      status: "stuck",
      title: "CI health loop",
      summary: "dispatch goal ci-health",
      currentStep: "kody: in-process hand-off -> dev-ci-health (hop 1/60)",
      decision: null,
      startedAt: "2026-07-06T06:00:00.000Z",
      updatedAt: "2026-07-06T06:01:00.000Z",
      durationMs: 61_000,
      kodyRunId: "kody-run-1",
      githubRunId: "123456",
      githubRunUrl: "https://github.com/test/repo/actions/runs/123456",
      logUrl: null,
      statePath: null,
      sourcePath: "logs/goals/ci-health/runs/run.jsonl",
      action: "run",
      capability: null,
      workflow: "dev-ci-health",
      implementation: "goal-manager",
      agent: "kody",
      model: "claude/claude-sonnet-4-5",
      modelProvider: "anthropic",
      modelName: "Claude Sonnet 4.5",
      reasoningEffort: null,
      actor: "operator",
    };

    const diagnosis = agencyRunDiagnosis(run, [
      {
        event: "kody: in-process hand-off",
        time: "2026-07-06T06:01:00.000Z",
        summary: "dev-ci-health (hop 1/60)",
      },
    ]);

    expect(diagnosis.status).toBe("Stuck");
    expect(diagnosis.pointLabel).toBe("Stopped at");
    expect(diagnosis.stoppedAt).toBe("ci-health -> dev-ci-health");
    expect(diagnosis.why).toBe(
      "dev-ci-health was expected to report back after the hand-off, but no completion event is recorded.",
    );
    expect(diagnosis.lastObserved).toBe("kody: in-process hand-off: dev-ci-health (hop 1/60)");
    expect(diagnosis.expectedNextEvent).toBe(
      "dev-ci-health should report progress or finish.",
    );
    expect(diagnosis.missingEvidence).toContain("No final outcome event.");
    expect(diagnosis.owner).toBe("dev-ci-health");
    expect(diagnosis.nextAction).toBe(
      "Open the raw timeline or source log and check why dev-ci-health did not report back.",
    );
  });

  it("shows the child goal as the stuck point when a loop waits on dispatched work", () => {
    const run: AgencyRunSummary = {
      id: "run-2",
      kind: "loop",
      targetId: "ci-health",
      targetLabel: "ci-health",
      targetModel: "loop",
      origin: "manual",
      status: "stuck",
      title: "CI health loop",
      summary: "stuck waiting on goal dev-ci-health",
      currentStep: "dev-ci-health: active / pending evidence",
      decision: null,
      startedAt: "2026-07-06T06:00:00.000Z",
      updatedAt: "2026-07-06T06:25:00.000Z",
      durationMs: 1_500_000,
      kodyRunId: "kody-run-2",
      githubRunId: null,
      githubRunUrl: null,
      logUrl: null,
      statePath: "todos/dev-ci-health.json",
      sourcePath: "logs/goals/ci-health/runs/run.jsonl",
      action: "run",
      capability: null,
      workflow: "dev-ci-health",
      implementation: "goal-manager",
      agent: "kody",
      model: "claude/claude-sonnet-4-5",
      modelProvider: "anthropic",
      modelName: "Claude Sonnet 4.5",
      reasoningEffort: null,
      actor: "operator",
    };

    const diagnosis = agencyRunDiagnosis(run, [], [
      "Hand-off: kody -> dev-ci-health (hop 1/60).",
    ]);

    expect(diagnosis.stoppedAt).toBe("ci-health -> dev-ci-health");
    expect(diagnosis.why).toBe(
      "dev-ci-health did not finish or report new progress after ci-health handed work to it.",
    );
    expect(diagnosis.lastObserved).toBe("dev-ci-health: active / pending evidence");
    expect(diagnosis.expectedNextEvent).toBe(
      "dev-ci-health should report progress or completion.",
    );
    expect(diagnosis.missingEvidence).toEqual([
      "No completion event from dev-ci-health.",
      "No final outcome event.",
    ]);
    expect(diagnosis.owner).toBe("dev-ci-health");
  });

  it("does not show fallback run facts while run story detail is loading", () => {
    const run = {
      sourcePath: "logs/goals/ai-agency-health/runs/run.jsonl",
      githubRunId: "28770677390",
    } as AgencyRunSummary;

    expect(shouldWaitForRunStory(run, false, true)).toBe(true);
    expect(shouldWaitForRunStory(run, true, true)).toBe(false);
    expect(shouldWaitForRunStory(run, false, false)).toBe(false);
  });
});
