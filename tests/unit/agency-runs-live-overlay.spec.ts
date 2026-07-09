import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAgencyRuns } from "../../src/dashboard/lib/agency-runs";
import { readStateText } from "../../src/dashboard/lib/state-repo";

vi.mock("../../src/dashboard/lib/state-repo", () => ({
  readStateText: vi.fn(),
}));

describe("listAgencyRuns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T06:30:00Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("overlays live GitHub workflow status on non-terminal Kody rows", async () => {
    vi.mocked(readStateText).mockResolvedValue({
      content: JSON.stringify({
        updatedAt: "2026-07-06T06:19:43.979Z",
        runs: [
          {
            id: "goal:ci-health:gh-123-1-1",
            subjectType: "goal",
            subjectId: "ci-health",
            status: "running",
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
      repo: "r1",
    });

    expect(payload.runs[0]).toMatchObject({
      id: "goal:ci-health:gh-123-1-1",
      status: "running",
      githubRunUrl: "https://github.com/o/r/actions/runs/123",
    });
    expect(octokit.actions.listWorkflowRunsForRepo).toHaveBeenCalledTimes(1);
  });

  it("does not turn a completed dispatch row back into running from its GitHub run", async () => {
    vi.mocked(readStateText).mockResolvedValue({
      content: JSON.stringify({
        updatedAt: "2026-07-06T06:19:43.979Z",
        runs: [
          {
            id: "loop:daily-web-release-loop:gh-28789039386-1-1",
            subjectType: "loop",
            subjectId: "daily-web-release-loop",
            status: "success",
            title: "daily-web-release-loop",
            summary: "dispatch goal web-release-2026-07-06",
            currentStep: "loop.tick.dispatch",
            updatedAt: "2026-07-06T06:19:43.979Z",
            githubRunId: "28789039386",
            githubRunUrl:
              "https://github.com/A-Guy-educ/A-Guy-Web/actions/runs/28789039386",
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
                id: 28789039386,
                status: "in_progress",
                conclusion: null,
                html_url:
                  "https://github.com/A-Guy-educ/A-Guy-Web/actions/runs/28789039386",
              },
            ],
          },
        }),
      },
    };

    const payload = await listAgencyRuns({
      octokit: octokit as never,
      owner: "o",
      repo: "r-dispatch-terminal",
    });

    expect(payload.runs[0]).toMatchObject({
      id: "loop:daily-web-release-loop:gh-28789039386-1-1",
      status: "success",
      currentStep: "loop.tick.dispatch",
      summary: "dispatch goal web-release-2026-07-06",
    });
  });

  it("shows a loop dispatch through the failed child workflow outcome", async () => {
    vi.mocked(readStateText)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          updatedAt: "2026-07-06T12:23:12.356Z",
          runs: [
            {
              id: "workflow:web-release:gh-28789039386-1-6",
              subjectType: "workflow",
              subjectId: "web-release",
              status: "failed",
              title: "Web Release",
              summary:
                "release-merge: PR #763 auto-merge did not complete after 1800s (state: OPEN)",
              currentStep: "release-merge",
              updatedAt: "2026-07-06T12:23:12.356Z",
              githubRunId: "28789039386",
            },
            {
              id: "loop:daily-web-release-loop:gh-28789039386-1-1",
              subjectType: "loop",
              subjectId: "daily-web-release-loop",
              status: "success",
              title: "daily-web-release-loop",
              summary: "dispatch goal web-release-2026-07-06",
              currentStep: "loop.tick.dispatch",
              updatedAt: "2026-07-06T11:45:45.513Z",
              githubRunId: "28789039386",
            },
          ],
        }),
        etag: "etag-1",
        path: "runs/index.json",
        sha: "sha-1",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          state: "active",
          type: "web-release",
          stage: "workflow",
          facts: {
            releasePromotionPrExists: true,
            releaseBranchMerged: false,
            productionDeployed: false,
          },
          blockers: [],
          updatedAt: "2026-07-06T11:52:37Z",
        }),
        path: "todos/web-release-2026-07-06.json",
        sha: "sha-2",
      });

    const octokit = {
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({
          data: { workflow_runs: [] },
        }),
      },
    };

    const payload = await listAgencyRuns({
      octokit: octokit as never,
      owner: "o",
      repo: "r-child-workflow-failed",
    });

    expect(payload.runs.find((run) => run.kind === "loop")).toMatchObject({
      id: "loop:daily-web-release-loop:gh-28789039386-1-1",
      status: "failed",
      currentStep: "web-release-2026-07-06: release-merge",
      summary:
        "release-merge: PR #763 auto-merge did not complete after 1800s (state: OPEN)",
    });
  });

  it("does not turn an idle waiting loop row into a GitHub shell success", async () => {
    vi.mocked(readStateText).mockResolvedValue({
      content: JSON.stringify({
        runs: [
          {
            id: "loop:daily-web-release-loop:gh-28788241519-1-1",
            subjectType: "loop",
            subjectId: "daily-web-release-loop",
            status: "waiting",
            title: "daily-web-release-loop",
            summary:
              "already dispatched today at preferred time 02:00 Asia/Jerusalem",
            currentStep: "loop.tick.idle",
            updatedAt: "2026-07-06T11:51:07.846Z",
            githubRunId: "28788241519",
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
                id: 28788241519,
                status: "completed",
                conclusion: "success",
              },
            ],
          },
        }),
      },
    };

    const payload = await listAgencyRuns({
      octokit: octokit as never,
      owner: "o",
      repo: "r-idle-waiting",
    });

    expect(payload.runs[0]).toMatchObject({
      id: "loop:daily-web-release-loop:gh-28788241519-1-1",
      status: "waiting",
      currentStep: "loop.tick.idle",
      summary:
        "already dispatched today at preferred time 02:00 Asia/Jerusalem",
    });
  });

  it("does not let GitHub shell completion hide an active dispatch target", async () => {
    vi.mocked(readStateText)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          runs: [
            {
              id: "loop:daily-web-release-loop:gh-28758779842-1-1",
              subjectType: "loop",
              subjectId: "daily-web-release-loop",
              status: "running",
              title: "daily-web-release-loop",
              summary: "dispatch goal web-release-2026-07-06",
              currentStep: "loop.tick.dispatch",
              updatedAt: "2026-07-06T06:29:58Z",
              githubRunId: "28758779842",
            },
          ],
        }),
        etag: "etag-1",
        path: "runs/index.json",
        sha: "sha-1",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          state: "active",
          type: "web-release",
          stage: "workflow",
          facts: {},
          blockers: [],
          updatedAt: "2026-07-06T06:29:58Z",
        }),
        path: "todos/web-release-2026-07-06.json",
        sha: "sha-2",
      });

    const octokit = {
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({
          data: {
            workflow_runs: [
              {
                id: 28758779842,
                status: "completed",
                conclusion: "success",
              },
            ],
          },
        }),
      },
    };

    const payload = await listAgencyRuns({
      octokit: octokit as never,
      owner: "o",
      repo: "r-active-dispatch-target",
    });

    expect(payload.runs[0]).toMatchObject({
      id: "loop:daily-web-release-loop:gh-28758779842-1-1",
      status: "running",
      currentStep: "web-release-2026-07-06: workflow",
      summary: "waiting on goal web-release-2026-07-06",
    });
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
        listWorkflowRunsForRepo: vi
          .fn()
          .mockRejectedValue(new Error("rate limit")),
      },
    };

    const payload = await listAgencyRuns({
      octokit: octokit as never,
      owner: "o",
      repo: "r2",
    });

    expect(payload.runs[0]?.status).toBe("success");
  });

  it("shows non-terminal dispatch rows as stuck when their child goal is stale and active", async () => {
    vi.mocked(readStateText)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          runs: [
            {
              id: "loop:daily-web-release-loop:gh-28758779842-1-1",
              subjectType: "loop",
              subjectId: "daily-web-release-loop",
              status: "waiting",
              title: "daily-web-release-loop",
              summary: "dispatch goal web-release-2026-07-06",
              currentStep: "loop.tick.dispatch",
              decision: "dispatch - dispatch goal web-release-2026-07-06",
              updatedAt: "2026-07-05T23:37:45Z",
              githubRunId: "28758779842",
            },
          ],
        }),
        etag: "etag-1",
        path: "runs/index.json",
        sha: "sha-1",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          state: "active",
          type: "web-release",
          stage: "workflow",
          facts: {
            pendingEvidence: "releasePrExists",
          },
          blockers: [],
          updatedAt: "2026-07-05T23:37:51Z",
        }),
        path: "todos/web-release-2026-07-06.json",
        sha: "sha-2",
      });

    const octokit = {
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({
          data: {
            workflow_runs: [
              {
                id: 28758779842,
                status: "completed",
                conclusion: "success",
              },
            ],
          },
        }),
      },
    };

    const payload = await listAgencyRuns({
      octokit: octokit as never,
      owner: "o",
      repo: "r3",
    });

    expect(payload.runs[0]).toMatchObject({
      id: "loop:daily-web-release-loop:gh-28758779842-1-1",
      status: "stuck",
      currentStep: "web-release-2026-07-06: workflow / releasePrExists",
      summary: "stuck waiting on goal web-release-2026-07-06",
    });
  });
});
