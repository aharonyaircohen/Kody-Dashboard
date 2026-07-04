import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardHomeSource = () =>
  readFileSync(
    join(
      process.cwd(),
      "src/dashboard/lib/components/DashboardHome.tsx",
    ),
    "utf8",
  );

describe("DashboardHome CI status", () => {
  it("shows the shared CI banner on the main dashboard page", () => {
    const source = dashboardHomeSource();

    expect(source).toContain('import { KodyStatusBanner } from "./KodyStatusBanner"');
    expect(source).toContain("useDefaultBranchCI()");
    expect(source).toContain("<KodyStatusBanner");
    expect(source).toContain("mainCi={mainCi}");
    expect(source).toContain("ci={mainCi}");
  });
});
