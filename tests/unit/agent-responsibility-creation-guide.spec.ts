import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { loadChatDefaults } from "../../src/dashboard/lib/chat-defaults";
import { DEFAULT_EXECUTABLE } from "../../src/dashboard/lib/chat-defaults/defaults";

const DUTY_GUIDE = readFileSync("docs/agent-responsibilities.md", "utf8");
const DUTY_TOOLS_SOURCE = readFileSync(
  "app/api/kody/chat/tools/agent-responsibility-tools.ts",
  "utf8",
);
const DUTY_FILES_SOURCE = readFileSync(
  "src/dashboard/lib/agent-responsibilities-files.ts",
  "utf8",
);
const TICKED_FILES_SOURCE = readFileSync(
  "src/dashboard/lib/ticked/files.ts",
  "utf8",
);

describe("agentResponsibility creation guide wiring", () => {
  it("documents the user-facing agentResponsibility contract", () => {
    expect(DUTY_GUIDE).toContain("A **agentResponsibility** is recurring work");
    expect(DUTY_GUIDE).toContain("`create_or_update_agent_responsibility`");
    expect(DUTY_GUIDE).toContain("`agent`");
    expect(DUTY_GUIDE).toContain("`reviewer`");
    expect(DUTY_GUIDE).toContain("Runtime state");
    expect(DUTY_GUIDE).not.toContain("Progress types");
    expect(DUTY_GUIDE).not.toContain("`stage`");
  });

  it("exposes a guide tool before agentResponsibility creation", () => {
    expect(DUTY_TOOLS_SOURCE).toContain(
      "read_agent_responsibility_creation_guide",
    );
    expect(DUTY_TOOLS_SOURCE).toContain("canCreateAgentResponsibility: true");
    expect(DUTY_TOOLS_SOURCE).toContain("docs/agent-responsibilities.md");
    expect(DUTY_TOOLS_SOURCE).toContain(
      "Before calling it, call read_agent_responsibility_creation_guide",
    );
    // The bundle's agentAction declares the tool the agent should call.
    expect(DEFAULT_EXECUTABLE.tools).toContain(
      "read_agent_responsibility_creation_guide",
    );
  });

  it("creates usable agentResponsibilities without authoring raw state keys", () => {
    // The dashboard writes the canonical agent slug to profile.json and
    // mirrors it to agent for legacy readers. Both must be set when the
    // tool is given an agent value.
    expect(DUTY_TOOLS_SOURCE).toContain("agent: createAgent!");
    expect(DUTY_TOOLS_SOURCE).toContain("agent: nextAgent");
    expect(DUTY_TOOLS_SOURCE).toContain("reviewer: input.reviewer");
    expect(DUTY_TOOLS_SOURCE).toContain("schedule: input.schedule");
    expect(DUTY_TOOLS_SOURCE).not.toContain("stage: input.stage");
    expect(DUTY_TOOLS_SOURCE).not.toContain("DUTY_STAGE");
    expect(DUTY_TOOLS_SOURCE).not.toContain("body += `## State");
    expect(DUTY_TOOLS_SOURCE).not.toContain("data.lastRunISO");
  });

  it("exposes a unified create-or-update tool, not a create-only tool", () => {
    expect(DUTY_TOOLS_SOURCE).toContain(
      "create_or_update_agent_responsibility",
    );
    expect(DUTY_TOOLS_SOURCE).not.toContain(
      '"create_kody_agentResponsibility"',
    );
    expect(DUTY_TOOLS_SOURCE).not.toContain(
      "'create_kody_agentResponsibility'",
    );
    // The bundle's agentAction declares the tool the agent should call.
    expect(DEFAULT_EXECUTABLE.tools).toContain(
      "create_or_update_agent_responsibility",
    );
    expect(DEFAULT_EXECUTABLE.tools).not.toContain(
      "create_kody_agentResponsibility",
    );
  });

  it("branches on existing-folder presence to choose create vs update", () => {
    expect(DUTY_TOOLS_SOURCE).toContain('action: "created"');
    expect(DUTY_TOOLS_SOURCE).toContain('action: "updated"');
    expect(DUTY_TOOLS_SOURCE).toContain("missing_required_fields");
  });

  it("enforces read-merge semantics on update (no overwrite of omitted fields)", () => {
    expect(DUTY_TOOLS_SOURCE).toContain("existing.sha");
    expect(DUTY_TOOLS_SOURCE).toContain("chore(agentResponsibilities): update");
    expect(DUTY_TOOLS_SOURCE).toContain("feat(agentResponsibilities): add");
    // agent read-merge: prefer input.agent, then existing.agent.
    expect(DUTY_TOOLS_SOURCE).toContain("const agentProvided = input.agent");
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /input\.schedule\s*\?\?\s*existing\.schedule\s*\?\?\s*undefined/,
    );
    // Body resolution: explicit body wins; otherwise the existing body is
    // preserved.
    expect(DUTY_TOOLS_SOURCE).toContain("input.body !== undefined");
    expect(DUTY_TOOLS_SOURCE).toContain("existing.body");
  });
  it("accepts `agent` as the agentResponsibility identity field", async () => {
    expect(DUTY_TOOLS_SOURCE).toMatch(/agent:\s*z[\s\S]*?\.string\(\)/);
    expect(DUTY_TOOLS_SOURCE).not.toContain("runner:");
    expect(DUTY_FILES_SOURCE).toContain("profile.agent = agentSlug");
    expect(DUTY_FILES_SOURCE).not.toContain("profile.runner");
    expect(DUTY_FILES_SOURCE).toContain(
      'const agentSlug = (opts.agent ?? "").trim()',
    );
    const bundle = await loadChatDefaults("acme", "repo");
    const createAgentResponsibility =
      bundle.skills["create-agentResponsibility"];
    expect(createAgentResponsibility).toBeDefined();
    expect(createAgentResponsibility!.body).toContain("`agent`");
    expect(createAgentResponsibility!.body).toContain("`config.agent`");
  });

  it("supports multi-agentAction agentResponsibilities via the `agentActions` array", () => {
    // Schema exposes the plural array as a first-class field.
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /agentActions:\s*z[\s\S]*?\.array\(z\.string/,
    );
    // The body builder produces a `## AgentActions` (plural) section when
    // more than one agentAction is supplied, and stays on the singular
    // `## AgentAction` for the 1-element case.
    expect(DUTY_TOOLS_SOURCE).toContain("## AgentAction");
    expect(DUTY_TOOLS_SOURCE).toContain("## AgentActions");
    // The create path forwards the validated array to writeAgentResponsibilityFile.
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /agentActions:\s*agentActions\.length\s*>\s*0/,
    );
    // The update path forwards nextAgentActions (read-merged with
    // existing.agentActions) to writeAgentResponsibilityFile.
    expect(DUTY_TOOLS_SOURCE).toContain("nextAgentActions");
  });

  it("accepts raw profile.json field overrides via the `profile` parameter", () => {
    // The TickWriteOptions interface declares the raw override.
    expect(TICKED_FILES_SOURCE).toContain(
      "extraProfile?: Record<string, unknown>",
    );
    // The tool schema exposes the `profile` object to the model.
    expect(DUTY_TOOLS_SOURCE).toMatch(
      /profile:\s*z[\s\S]*?\.record\(z\.string\(\),\s*z\.unknown\(\)\)/,
    );
    // The tool forwards it as `extraProfile` to writeAgentResponsibilityFile.
    expect(DUTY_TOOLS_SOURCE).toContain("extraProfile: input.profile");
    // The buildAgentResponsibilityProfile layer merges extraProfile on top of the typed
    // fields, but typed values WIN for every key this function manages
    // (identity + schedule/disabled/agents/agent/reviewer/etc.) — the
    // override is for ADDING fields, not clobbering typed ones.
    expect(DUTY_FILES_SOURCE).toContain("opts.extraProfile");
    expect(DUTY_FILES_SOURCE).toContain("MANAGED_PROFILE_KEYS");
    expect(DUTY_FILES_SOURCE).toMatch(/MANAGED_PROFILE_KEYS\.has\(key\)/);
  });

  it("does not expose report output mode on agentResponsibilities", () => {
    expect(DUTY_TOOLS_SOURCE).not.toMatch(
      /output:\s*z[\s\S]*?\.enum\(\[\s*"run"\s*,\s*"report"\s*\]\)/,
    );
    expect(DUTY_TOOLS_SOURCE).not.toContain("resolveOutput");
    expect(DUTY_TOOLS_SOURCE).not.toContain("buildRunStyleBody");
    expect(DUTY_TOOLS_SOURCE).not.toContain("buildReportStyleBody");
    expect(DUTY_TOOLS_SOURCE).not.toContain("reportSchema:");
    expect(DUTY_TOOLS_SOURCE).not.toContain("Maximum one report refresh");
    expect(DUTY_TOOLS_SOURCE).toContain(
      "Report generation belongs in a configured agentAction",
    );
    expect(DUTY_TOOLS_SOURCE).toContain(
      "run the configured report agentAction",
    );
  });
});
