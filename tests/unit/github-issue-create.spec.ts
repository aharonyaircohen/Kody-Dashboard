import { describe, expect, it, vi } from "vitest";
import { createIssueWithBestEffortMetadata } from "@dashboard/lib/github-issue-create";

function makeOctokit(overrides?: {
  addLabels?: () => Promise<unknown>;
  addAssignees?: () => Promise<unknown>;
}) {
  return {
    rest: {
      issues: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: 1,
            number: 42,
            title: "Fix chat",
            body: "",
            state: "open",
            labels: [],
            assignees: [],
            created_at: "2026-06-13T00:00:00Z",
            updated_at: "2026-06-13T00:00:00Z",
            closed_at: null,
            html_url: "https://github.com/acme/repo/issues/42",
          },
        }),
        addLabels: vi.fn(
          overrides?.addLabels ?? (() => Promise.resolve({ data: [] })),
        ),
        addAssignees: vi.fn(
          overrides?.addAssignees ?? (() => Promise.resolve({ data: [] })),
        ),
      },
    },
  };
}

describe("createIssueWithBestEffortMetadata", () => {
  it("creates the issue before applying labels and assignees", async () => {
    const octokit = makeOctokit();

    const result = await createIssueWithBestEffortMetadata(octokit as any, {
      owner: "acme",
      repo: "repo",
      title: "Fix chat",
      labels: ["bug"],
      assignees: ["aguy"],
    });

    expect(result.data.number).toBe(42);
    expect(result.metadataWarnings).toEqual([]);
    expect(octokit.rest.issues.create).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      title: "Fix chat",
      body: "",
    });
    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      issue_number: 42,
      labels: ["bug"],
    });
    expect(octokit.rest.issues.addAssignees).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      issue_number: 42,
      assignees: ["aguy"],
    });
  });

  it("keeps the created issue when metadata application fails", async () => {
    const octokit = makeOctokit({
      addLabels: () => Promise.reject(new Error("Label does not exist")),
      addAssignees: () => Promise.reject(new Error("User cannot be assigned")),
    });

    const result = await createIssueWithBestEffortMetadata(octokit as any, {
      owner: "acme",
      repo: "repo",
      title: "Fix chat",
      labels: ["missing"],
      assignees: ["outside-user"],
    });

    expect(result.data.number).toBe(42);
    expect(result.metadataWarnings).toEqual([
      "Labels not applied: Label does not exist",
      "Assignees not applied: User cannot be assigned",
    ]);
  });
});
