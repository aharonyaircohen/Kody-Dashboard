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
  it("shows main CI in the compact header status chip", () => {
    const source = dashboardHomeSource();

    expect(source).toContain("useDefaultBranchCI()");
    expect(source).not.toContain("<KodyStatusBanner");
    expect(source).toContain('text: "CI failing"');
    expect(source).toContain('text: "CI running"');
    expect(source).toContain('text: "CI green"');
    expect(source).toContain("mainCi={mainCi}");
    expect(source).toContain("mainCiLoading={mainCiFetching && !mainCi}");
    expect(source).toContain("ci={mainCi}");
  });
});
