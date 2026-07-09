import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardHomeSource = () =>
  readFileSync(
    join(process.cwd(), "src/dashboard/lib/components/DashboardHome.tsx"),
    "utf8",
  );

describe("DashboardHome CI status", () => {
  it("shows main CI in the compact health row", () => {
    const source = dashboardHomeSource();

    expect(source).toContain("useDefaultBranchCI()");
    expect(source).not.toContain("<KodyStatusBanner");
    expect(source).toContain("function HealthRow");
    expect(source).toContain("Health");
    expect(source).toContain('text: "Failing"');
    expect(source).toContain('text: "Running"');
    expect(source).toContain('text: "Green"');
    expect(source).toContain("mainCi={mainCi}");
    expect(source).toContain("mainCiLoading={mainCiFetching && !mainCi}");
    expect(source).toContain("ci={mainCi}");
  });
});
