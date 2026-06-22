import { describe, expect, it } from "vitest";
import { buildDutyBody, buildDutyProfile } from "@dashboard/lib/duties-files";

describe("folder-backed duty files", () => {
  it("serializes metadata into profile.json, not duty.md frontmatter", () => {
    const profile = buildDutyProfile({
      octokit: {} as never,
      slug: "repo-graph",
      title: "Repo Graph",
      body: "ignored here",
      action: "repo-graph",
      executable: "repo-graph",
      schedule: "1d",
      disabled: true,
      agent: "cto",
      reviewer: "@qa",
      mentions: ["@alice", "bob"],
      dutyTools: ["ensure_issue"],
      readsFrom: ["company-graph"],
      writesTo: ["repo-graph"],
    });

    expect(profile).toMatchObject({
      name: "repo-graph",
      describe: "Repo Graph",
      action: "repo-graph",
      executable: "repo-graph",
      every: "1d",
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
    const profile = buildDutyProfile({
      octokit: {} as never,
      slug: "from-agent",
      title: "From Agent",
      body: "ignored",
      agent: "qa",
    });
    expect(profile.agent).toBe("qa");
  });

  it("merges `extraProfile` raw overrides on top of the typed fields", () => {
    const profile = buildDutyProfile({
      octokit: {} as never,
      slug: "override",
      title: "Override",
      body: "ignored",
      agent: "qa",
      schedule: "1d",
      extraProfile: {
        version: 2,
        customFlag: "yes",
        every: "OVERRIDDEN", // typed schedule still wins
      },
    });
    expect(profile).toMatchObject({
      agent: "qa",
      version: 2,
      customFlag: "yes",
    });
    // Typed schedule beats the override.
    expect(profile.every).toBe("1d");
  });

  it("protects the identity keys from extraProfile overrides", () => {
    const profile = buildDutyProfile({
      octokit: {} as never,
      slug: "identity",
      title: "Identity",
      body: "ignored",
      extraProfile: { name: "hijacked", describe: "hijacked" },
    });
    expect(profile.name).toBe("identity");
    expect(profile.describe).toBe("Identity");
  });

  it("keeps duty.md as titled body prose only", () => {
    const body = buildDutyBody(
      "Repo Graph",
      "# Old Title\n\n## Job\n\nRefresh the graph.",
    );

    expect(body).toBe("# Repo Graph\n\n## Job\n\nRefresh the graph.\n");
    expect(body).not.toContain("---");
    expect(body).not.toContain("action:");
  });
});
