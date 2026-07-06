import { describe, expect, it, vi } from "vitest";

import { listAgencyRuns } from "../src/dashboard/lib/agency-runs";
import { readStateText } from "../src/dashboard/lib/state-repo";

vi.mock("../src/dashboard/lib/state-repo", () => ({
  readStateText: vi.fn(),
}));

describe("listAgencyRuns", () => {
  it("overlays live GitHub workflow status on persisted Kody rows", async () => {
    vi.mocked(readStateText).mockResolvedValue({
      content: JSON.stringify({
        updatedAt: "2026-07-06T06:19:43.979Z",
        runs: [
          {
            id: "goal:ci-health:gh-123-1-1",
            subjectType: "goal",
            subjectId: "ci-health",
            status: "success",
            title: "ci-health",
            summary: "dispatch dev-ci-health: ready for loop tick",
            updatedAt: "2026-07-06T06:19:43.979Z",
            githubRunId: "123",
            githubRunUrl: "https://github.com/o/r/actions/runs/123",
          },
        ],
      }),
      etag: "etag-1",
      path: "runs/index.json",
      sha: "sha-1",
    });

    const octokit = {
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({
          data: {
            workflow_runs: [
              {
                id: 123,
                status: "in_progress",
                conclusion: null,
                html_url: "https://github.com/o/r/actions/runs/123",
              },
            ],
          },
        }),
      },
    };

    const payload = await listAgencyRuns({
      octokit: octokit as never,
      owner: "o",
      repo: "r",
    });

    expect(payload.runs[0]).toMatchObject({
      id: "goal:ci-health:gh-123-1-1",
      status: "running",
      githubRunUrl: "https://github.com/o/r/actions/runs/123",
    });
    expect(octokit.actions.listWorkflowRunsForRepo).toHaveBeenCalledTimes(1);
  });

  it("keeps persisted statuses when the live GitHub overlay is unavailable", async () => {
    vi.mocked(readStateText).mockResolvedValue({
      content: JSON.stringify({
        runs: [
          {
            id: "goal:ci-health:gh-123-1-1",
            subjectType: "goal",
            subjectId: "ci-health",
            status: "success",
            title: "ci-health",
            githubRunId: "123",
          },
        ],
      }),
      etag: "etag-1",
      path: "runs/index.json",
      sha: "sha-1",
    });

    const octokit = {
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockRejectedValue(new Error("rate limit")),
      },
    };

    const payload = await listAgencyRuns({
      octokit: octokit as never,
      owner: "o",
      repo: "r",
    });

    expect(payload.runs[0]?.status).toBe("success");
  });
});
