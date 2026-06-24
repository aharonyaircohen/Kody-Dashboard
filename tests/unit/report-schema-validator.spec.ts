import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function makeReportsDir() {
  const root = mkdtempSync(join(tmpdir(), "kody-reports-"));
  const reports = join(root, "reports");
  mkdirSync(reports, { recursive: true });
  return { root, reports };
}

function runValidator(root: string) {
  return execFileSync(
    "node",
    ["scripts/validate-reports.mjs", `${root}/reports`],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

describe("validate-reports", () => {
  it("accepts reports that follow the shared frontmatter schema", () => {
    const { root, reports } = makeReportsDir();
    writeFileSync(join(reports, "_schema.yaml"), "type: object\n");
    writeFileSync(
      join(reports, "health-check.md"),
      [
        "---",
        'generatedAt: "2026-06-08T12:00:00Z"',
        "agentResponsibilitySlug: health-check",
        "reviewStatus: action-needed",
        "reviewArea: operations",
        "findings:",
        "  - id: all-clear",
        "    severity: low",
        "    title: All checks are green",
        "    data:",
        "      checkedRuns: 4",
        "suggestedActions:",
        "  - id: fix-ci-42",
        "    type: dispatch",
        "    label: Run fix-ci on PR #42",
        "    agentAction: fix-ci",
        "    target: 42",
        "  - id: create-cleanup-task",
        "    type: create-task",
        "    label: Create cleanup task",
        "    title: Clean up stale branches",
        "  - id: dismiss-known-noise",
        "    type: dismiss",
        "    label: Dismiss known noise",
        "---",
        "# Health Check",
        "",
        "All checks are green.",
      ].join("\n"),
    );

    expect(runValidator(root)).toContain("Validated 1 report file(s).");
  });

  it("rejects unknown review status values", () => {
    const { root, reports } = makeReportsDir();
    writeFileSync(join(reports, "_schema.yaml"), "type: object\n");
    writeFileSync(
      join(reports, "bad-review.md"),
      [
        "---",
        'generatedAt: "2026-06-08T12:00:00Z"',
        "reviewStatus: urgent",
        "findings:",
        "  - id: all-clear",
        "    severity: low",
        "    title: All checks are green",
        "---",
        "# Bad Review",
      ].join("\n"),
    );

    expect(() => runValidator(root)).toThrow(/reviewStatus must be/);
  });

  it("rejects reports without required finding fields", () => {
    const { root, reports } = makeReportsDir();
    writeFileSync(join(reports, "_schema.yaml"), "type: object\n");
    writeFileSync(
      join(reports, "bad.md"),
      [
        "---",
        'generatedAt: "2026-06-08T12:00:00Z"',
        "findings:",
        "  - id: missing-title",
        "    severity: urgent",
        "---",
        "# Bad",
      ].join("\n"),
    );

    expect(() => runValidator(root)).toThrow(/findings\[0\] missing title/);
  });

  it("rejects invalid suggested actions", () => {
    const { root, reports } = makeReportsDir();
    writeFileSync(join(reports, "_schema.yaml"), "type: object\n");
    writeFileSync(
      join(reports, "bad-action.md"),
      [
        "---",
        'generatedAt: "2026-06-08T12:00:00Z"',
        "findings:",
        "  - id: failing-ci",
        "    severity: high",
        "    title: CI is red",
        "suggestedActions:",
        "  - id: fix-ci",
        "    type: dispatch",
        "    label: Run fix-ci",
        "---",
        "# Bad Action",
      ].join("\n"),
    );

    expect(() => runValidator(root)).toThrow(
      /suggestedActions\[0\] dispatch requires agentAction/,
    );
  });
});
