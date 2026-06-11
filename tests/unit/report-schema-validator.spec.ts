import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function makeReportsDir() {
  const root = mkdtempSync(join(tmpdir(), "kody-reports-"));
  const reports = join(root, ".kody", "reports");
  mkdirSync(reports, { recursive: true });
  return { root, reports };
}

function runValidator(root: string) {
  return execFileSync(
    "node",
    ["scripts/validate-reports.mjs", `${root}/.kody/reports`],
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
        "dutySlug: health-check",
        "reviewStatus: action-needed",
        "reviewArea: operations",
        "findings:",
        "  - id: all-clear",
        "    severity: low",
        "    title: All checks are green",
        "    data:",
        "      checkedRuns: 4",
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
});
