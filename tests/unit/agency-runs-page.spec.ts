import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
});
