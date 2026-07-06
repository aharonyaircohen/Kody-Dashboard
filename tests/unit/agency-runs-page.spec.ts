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

  it("opens run details with operator outcome before raw events", () => {
    const outcomeIndex = pageSource.indexOf("What happened");
    const nextIndex = pageSource.indexOf("Next state");
    const rawIndex = pageSource.indexOf("Raw event timeline");

    expect(pageSource).toContain("function operatorHappened");
    expect(pageSource).toContain("function operatorNext");
    expect(pageSource).toContain("What happened");
    expect(pageSource).toContain("Next state");
    expect(pageSource).toContain("Raw event timeline");
    expect(outcomeIndex).toBeGreaterThan(-1);
    expect(nextIndex).toBeGreaterThan(outcomeIndex);
    expect(rawIndex).toBeGreaterThan(nextIndex);
  });
});
