import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const DUTY_GUIDE = readFileSync("docs/duties.md", "utf8");
const DUTY_TOOLS_SOURCE = readFileSync(
  "app/api/kody/chat/tools/duty-tools.ts",
  "utf8",
);
const AGENT_SOURCE = readFileSync("src/dashboard/lib/agents.ts", "utf8");

describe("duty creation guide wiring", () => {
  it("documents the user-facing duty contract", () => {
    expect(DUTY_GUIDE).toContain("A **duty** is recurring work");
    expect(DUTY_GUIDE).toContain("`create_kody_duty`");
    expect(DUTY_GUIDE).toContain("`runner`");
    expect(DUTY_GUIDE).toContain("`reviewer`");
    expect(DUTY_GUIDE).toContain("Runtime state");
    expect(DUTY_GUIDE).not.toContain("Progress types");
    expect(DUTY_GUIDE).not.toContain("`stage`");
  });

  it("exposes a guide tool before duty creation", () => {
    expect(DUTY_TOOLS_SOURCE).toContain("read_duty_creation_guide");
    expect(DUTY_TOOLS_SOURCE).toContain("canCreateDuty: true");
    expect(DUTY_TOOLS_SOURCE).toContain("docs/duties.md");
    expect(DUTY_TOOLS_SOURCE).toContain(
      "Before calling it, call read_duty_creation_guide",
    );
    expect(AGENT_SOURCE).toContain("read_duty_creation_guide");
  });

  it("creates usable duties without authoring raw state keys", () => {
    expect(DUTY_TOOLS_SOURCE).toContain("runner: input.runner");
    expect(DUTY_TOOLS_SOURCE).toContain("reviewer: input.reviewer");
    expect(DUTY_TOOLS_SOURCE).toContain("schedule: input.schedule");
    expect(DUTY_TOOLS_SOURCE).not.toContain("stage: input.stage");
    expect(DUTY_TOOLS_SOURCE).not.toContain("DUTY_STAGE");
    expect(DUTY_TOOLS_SOURCE).not.toContain("body += `## State");
    expect(DUTY_TOOLS_SOURCE).not.toContain("data.lastRunISO");
  });
});
