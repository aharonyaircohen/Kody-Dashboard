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

describe("DashboardHome layout", () => {
  it("keeps the overview first and removes redundant home sections", () => {
    const source = dashboardHomeSource();
    const atAGlance = source.indexOf('title="At a glance"');
    const engineHealth = source.indexOf("<EngineHealthCard");
    const happeningNow = source.indexOf("<HappeningNow");
    const needsAttention = source.indexOf("Needs attention");

    expect(source).not.toContain("TriageStrip");
    expect(source).not.toContain("AgentGoals / agentLoops");
    expect(source).not.toContain("Team channels");
    expect(source).not.toContain("Open board");
    expect(source).not.toContain("<ModelsOverview");
    expect(source).not.toContain("<ChannelsOverview");
    expect(atAGlance).toBeGreaterThan(-1);
    expect(engineHealth).toBeGreaterThan(atAGlance);
    expect(happeningNow).toBeGreaterThan(engineHealth);
    expect(needsAttention).toBeGreaterThan(happeningNow);
  });
});
