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
      staff: "cto",
      stage: "report-refresh",
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
      staff: "cto",
      stage: "report-refresh",
      mentions: ["alice", "bob"],
      tools: ["ensure_issue"],
      readsFrom: ["company-graph"],
      writesTo: ["repo-graph"],
    });
  });

  it("keeps duty.md as titled body prose only", () => {
    const body = buildDutyBody("Repo Graph", "# Old Title\n\n## Job\n\nRefresh the graph.");

    expect(body).toBe("# Repo Graph\n\n## Job\n\nRefresh the graph.\n");
    expect(body).not.toContain("---");
    expect(body).not.toContain("action:");
  });
});
