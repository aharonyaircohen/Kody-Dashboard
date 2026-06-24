import { describe, expect, it } from "vitest";
import {
  buildAgentResponsibilityBody,
  buildAgentResponsibilityProfile,
} from "@dashboard/lib/agent-responsibilities-files";

describe("folder-backed agentResponsibility files", () => {
  it("serializes metadata into profile.json, not agent-responsibility.md frontmatter", () => {
    const profile = buildAgentResponsibilityProfile({
      octokit: {} as never,
      slug: "repo-graph",
      title: "Repo Graph",
      body: "ignored here",
      action: "repo-graph",
      agentAction: "repo-graph",
      disabled: true,
      agent: "cto",
      reviewer: "@qa",
      mentions: ["@alice", "bob"],
      agentResponsibilityTools: ["ensure_issue"],
      readsFrom: ["company-graph"],
      writesTo: ["repo-graph"],
    });

    expect(profile).toMatchObject({
      name: "repo-graph",
      describe: "Repo Graph",
      action: "repo-graph",
      agentAction: "repo-graph",
      disabled: true,
      // The engine reads `config.agent`; the dashboard mirrors the
      agent: "cto",
      reviewer: "qa",
      mentions: ["alice", "bob"],
      tools: ["ensure_issue"],
      readsFrom: ["company-graph"],
      writesTo: ["repo-graph"],
    });
    expect(profile).not.toHaveProperty("stage");
    expect(profile).not.toHaveProperty("assignee");
  });

  it("accepts the new `agent` input field as the primary name", () => {
    const profile = buildAgentResponsibilityProfile({
      octokit: {} as never,
      slug: "from-agent",
      title: "From Agent",
      body: "ignored",
      agent: "qa",
    });
    expect(profile.agent).toBe("qa");
  });

  it("merges `extraProfile` raw overrides on top of the typed fields", () => {
    const profile = buildAgentResponsibilityProfile({
      octokit: {} as never,
      slug: "override",
      title: "Override",
      body: "ignored",
      agent: "qa",
      extraProfile: {
        version: 2,
        customFlag: "yes",
        every: "OVERRIDDEN",
      },
    });
    expect(profile).toMatchObject({
      agent: "qa",
      version: 2,
      customFlag: "yes",
    });
    // Legacy cadence is managed outside agentResponsibility profiles.
    expect(
      (profile as unknown as Record<string, unknown>).every,
    ).toBeUndefined();
  });

  it("protects the identity keys from extraProfile overrides", () => {
    const profile = buildAgentResponsibilityProfile({
      octokit: {} as never,
      slug: "identity",
      title: "Identity",
      body: "ignored",
      extraProfile: { name: "hijacked", describe: "hijacked" },
    });
    expect(profile.name).toBe("identity");
    expect(profile.describe).toBe("Identity");
  });

  it("keeps agent-responsibility.md as titled body prose only", () => {
    const body = buildAgentResponsibilityBody(
      "Repo Graph",
      "# Old Title\n\n## Job\n\nRefresh the graph.",
    );

    expect(body).toBe("# Repo Graph\n\n## Job\n\nRefresh the graph.\n");
    expect(body).not.toContain("---");
    expect(body).not.toContain("action:");
  });
});
