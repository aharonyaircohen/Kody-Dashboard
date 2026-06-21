import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("Kody goal and duty assets", () => {
  it("keeps issue-bound task duties manual-only", () => {
    const leader = readJson(".kody/duties/task-leader/profile.json");
    const verifier = readJson(".kody/duties/task-verifier/profile.json");

    expect(leader).toMatchObject({ executable: "task-leader", every: "manual" });
    expect(verifier).toMatchObject({ executable: "task-verifier", every: "manual" });
  });

  it("routes the hourly monitor into company-graph with goal context", () => {
    const template = readJson(".kody/goals/templates/hourly-monitor-goal-smoke/state.json");
    const route = template.route as Array<Record<string, unknown>>;

    expect(template).toMatchObject({
      type: "monitor",
      destination: { evidence: ["companyGraphRefreshed"] },
    });
    expect(route[0]).toMatchObject({
      evidence: "companyGraphRefreshed",
      duty: "company-graph",
      executable: "company-graph",
      args: { goal: "hourly-monitor-goal-smoke" },
    });
  });


  it("activates a five-minute recurring smoke goal", () => {
    const config = readJson("kody.config.json");
    const company = config.company as { activeGoals: Array<Record<string, unknown> | string> };
    const activation = company.activeGoals.find(
      (goal): goal is Record<string, unknown> =>
        typeof goal === "object" && goal !== null && goal.template === "five-minute-goal-smoke",
    );
    const template = readJson(".kody/goals/templates/five-minute-goal-smoke/state.json");
    const route = template.route as Array<Record<string, unknown>>;

    expect(activation).toMatchObject({
      template: "five-minute-goal-smoke",
      every: "5m",
      idPrefix: "five-minute-goal-smoke",
    });
    expect(template).toMatchObject({
      kind: "template",
      templateId: "five-minute-goal-smoke",
      type: "monitor",
      destination: { evidence: ["companyGraphRefreshed"] },
    });
    expect(route[0]).toMatchObject({
      evidence: "companyGraphRefreshed",
      duty: "company-graph",
      executable: "company-graph",
      args: { goal: "five-minute-goal-smoke" },
    });
  });

  it("lets company-graph report goal evidence after refresh", () => {
    const profile = readJson(".kody/executables/company-graph/profile.json");
    const script = readFileSync(".kody/executables/company-graph/refresh-company-graph.sh", "utf8");
    const syntax = spawnSync("bash", ["-n", ".kody/executables/company-graph/refresh-company-graph.sh"], {
      encoding: "utf8",
    });

    expect(syntax.status).toBe(0);
    expect(profile).toMatchObject({
      inputs: [{ name: "goal", flag: "--goal", required: false }],
      scripts: { postflight: [{ script: "applyDutyReports" }] },
    });
    expect(script).toContain("KODY_ARG_GOAL");
    expect(script).toContain("KODY_DUTY_REPORT=");
    expect(script).toContain('"companyGraphRefreshed":true');
    expect(script).toContain("gh api -X PUT");
    expect(script).toContain('--input "$payload_file"');
  });
});
