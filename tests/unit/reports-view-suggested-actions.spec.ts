/**
 * Source-level structural tests for report suggested actions.
 *
 * ReportsView is hook-heavy and the repo intentionally does not carry
 * happy-dom / @testing-library/react, so this follows the existing structural
 * test pattern used by other dashboard components.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_VIEW_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/ReportsView.tsx",
);
const SOURCE = readFileSync(REPORTS_VIEW_PATH, "utf8");

describe("ReportsView suggested actions", () => {
  it("renders a suggested-actions section with all supported action types", () => {
    expect(SOURCE).toMatch(/function SuggestedActions\b/);
    expect(SOURCE).toMatch(/Suggested actions/);
    expect(SOURCE).toMatch(/action\.type === "dispatch"/);
    expect(SOURCE).toMatch(/action\.type === "create-task"/);
    expect(SOURCE).toMatch(/onDismiss\(action\.id\)/);
  });

  it("dispatch actions run an instant job through the jobs API", () => {
    const runBlock = SOURCE.match(
      /const runSuggestedAction = async[\s\S]*?\n\s*};/,
    );
    expect(
      runBlock,
      "ReportsView must define runSuggestedAction",
    ).not.toBeNull();
    expect(runBlock![0]).toMatch(/kodyApi\.jobs\.run\(/);
    expect(runBlock![0]).toMatch(/capability,/);
    expect(runBlock![0]).toMatch(/const capability = action\.capability/);
    expect(runBlock![0]).toMatch(/target: action\.target/);
    expect(runBlock![0]).toMatch(/flavor: "instant"/);
    expect(runBlock![0]).toMatch(/from report \$\{report\.path\}/);
  });

  it("create-task actions open the existing task dialog with report lineage", () => {
    expect(SOURCE).toMatch(/report: displayedReport \?\? selected/);
    expect(SOURCE).toMatch(/buildTaskPrefillFromAction/);
    expect(SOURCE).toMatch(/labels: \[`from-report:\$\{report\.slug\}`/);
    expect(SOURCE).toMatch(/Source report:/);
  });

  it("dismiss actions are local-only browser state", () => {
    expect(SOURCE).toMatch(/kody\.report-actions\.dismissed/);
    expect(SOURCE).toMatch(/window\.localStorage\.setItem/);
    expect(SOURCE).toMatch(/useDismissedReportActions/);
  });

  it("lets report runs render inside the dashboard detail pane", () => {
    expect(SOURCE).toMatch(/selectedRunId\?: string \| null/);
    expect(SOURCE).toMatch(/selectedRunId/);
    expect(SOURCE).toMatch(/useReport\(selected\?\.slug/);
    expect(SOURCE).toMatch(/onSelectRun/);
    expect(SOURCE).toMatch(/aria-label="View report run"/);
    expect(SOURCE).not.toMatch(/<RunHistory report=\{report\} \/>/);
  });
});
