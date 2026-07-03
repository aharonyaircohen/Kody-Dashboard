import { beforeEach, describe, expect, it, vi } from "vitest";

const createIssueWithBestEffortMetadata = vi.hoisted(() => vi.fn());

vi.mock("@dashboard/lib/github-issue-create", () => ({
  createIssueWithBestEffortMetadata: (...args: unknown[]) =>
    createIssueWithBestEffortMetadata(...args),
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createBugTools } from "../../app/api/kody/chat/tools/bug-tools";
import { createPlannerTools } from "../../app/api/kody/chat/tools/planner-tools";
import { createReleaseTools } from "../../app/api/kody/chat/tools/release-tools";
import { createTaskTools } from "../../app/api/kody/chat/tools/task-tools";

type ToolResult = {
  number: number;
  title: string;
  url: string;
};

type TestTool = {
  execute: (input: unknown) => Promise<ToolResult>;
};

function makeCreatedIssue(number = 77) {
  return {
    data: {
      number,
      title: "Internal link task",
      html_url: `https://github.com/acme/app/issues/${number}`,
      assignees: [{ login: "alice" }],
    },
    metadataWarnings: [],
  };
}

function makeCtx() {
  return {
    owner: "acme",
    repo: "app",
    actorLogin: "alice",
    octokit: {} as never,
  };
}

beforeEach(() => {
  createIssueWithBestEffortMetadata.mockReset();
  createIssueWithBestEffortMetadata.mockResolvedValue(makeCreatedIssue());
});

describe("chat issue-creation tools", () => {
  it("returns the dashboard task URL for feature issues", async () => {
    const tools = createTaskTools(makeCtx()) as unknown as {
      create_feature: TestTool;
    };

    const result = await tools.create_feature.execute({
      title: "Add exports",
      summary: "Users need exports.",
      requirements: "Add a CSV export.",
    });

    expect(result.url).toBe("/repo/acme/app/77");
  });

  it("adds preview context to chat-created task issue bodies", async () => {
    const tools = createTaskTools({
      ...makeCtx(),
      previewContext:
        "Current preview page:\nURL: https://preview.test/demo\nTitle: Demo",
    }) as unknown as {
      create_feature: TestTool;
    };

    await tools.create_feature.execute({
      title: "Match demo view",
      summary: "Users need the new page to match the demo.",
      requirements: "Build the page from the demo UI.",
    });

    expect(createIssueWithBestEffortMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining(
          "### View Example - Required Visual Contract",
        ),
      }),
    );
    expect(createIssueWithBestEffortMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining(
          "Do not substitute a new design direction",
        ),
      }),
    );
    expect(createIssueWithBestEffortMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining(
          "Current preview page:\nURL: https://preview.test/demo",
        ),
      }),
    );
  });

  it("returns the dashboard task URL for bug reports", async () => {
    const tools = createBugTools(makeCtx()) as unknown as {
      report_bug: TestTool;
    };

    const result = await tools.report_bug.execute({
      title: "Export crashes",
      pageUrl: "https://dashboard.test/exports",
      steps: "Open exports and click Download.",
    });

    expect(result.url).toBe("/repo/acme/app/77");
  });

  it("returns the dashboard task URL for mission-planner issues", async () => {
    const tools = createPlannerTools({
      ...makeCtx(),
      goalId: "mission-1",
    }) as unknown as {
      create_task_for_goal: TestTool;
    };

    const result = await tools.create_task_for_goal.execute({
      title: "Add exports",
      summary: "Users need exports.",
      requirements: "Add a CSV export.",
      category: "feature",
    });

    expect(result.url).toBe("/repo/acme/app/77");
  });

  it("adds preview context to mission-planner task issue bodies", async () => {
    const tools = createPlannerTools({
      ...makeCtx(),
      goalId: "mission-1",
      previewContext: "Current preview page:\nURL: https://preview.test/goal",
    }) as unknown as {
      create_task_for_goal: TestTool;
    };

    await tools.create_task_for_goal.execute({
      title: "Match planner demo",
      summary: "Users need this task to follow the demo.",
      requirements: "Use the demo page as the UI reference.",
      category: "feature",
    });

    expect(createIssueWithBestEffortMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining(
          "### View Example - Required Visual Contract",
        ),
      }),
    );
    expect(createIssueWithBestEffortMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining(
          "Current preview page:\nURL: https://preview.test/goal",
        ),
      }),
    );
  });

  it("returns the dashboard task URL for release request issues", async () => {
    const octokit = {
      rest: {
        issues: {
          create: vi.fn().mockResolvedValue({
            data: {
              number: 88,
              title: "Release request",
              html_url: "https://github.com/acme/app/issues/88",
            },
          }),
          createComment: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    };
    const tools = createReleaseTools({
      owner: "acme",
      repo: "app",
      actorLogin: "alice",
      octokit: octokit as never,
    }) as unknown as {
      request_release: TestTool;
    };

    const result = await tools.request_release.execute({
      notes: "Ship it.",
    });

    expect(result.url).toBe("/repo/acme/app/88");
  });
});
