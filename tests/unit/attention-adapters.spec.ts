import { describe, expect, it } from "vitest";
import {
  healthAttentionItems,
  taskAttentionItems,
} from "../../src/dashboard/lib/attention/adapters";
import type { KodyTask } from "../../src/dashboard/lib/types";

function task(overrides: Partial<KodyTask>): KodyTask {
  return {
    id: "task-1",
    issueNumber: 123,
    title: "Fix checkout",
    body: "",
    state: "open",
    labels: [],
    column: "open",
    kodyPhase: null,
    kodyFlow: null,
    createdAt: "2026-07-03T08:00:00.000Z",
    updatedAt: "2026-07-03T09:00:00.000Z",
    ...overrides,
  };
}

describe("attention adapters", () => {
  it("turns failed tasks into needs-you items without approve/reject actions", () => {
    const items = taskAttentionItems(
      [
        task({
          column: "failed",
          failureReason: "Tests failed",
          workflowRun: {
            id: 456,
            status: "completed",
            conclusion: "failure",
            html_url: "https://github.com/example/repo/actions/runs/456",
            created_at: "2026-07-03T08:00:00.000Z",
            updated_at: "2026-07-03T09:00:00.000Z",
            display_title: "Kody run",
            head_branch: "main",
            event: "issue_comment",
            run_number: 1,
            actor: "kody",
          },
        }),
      ],
      {
        onRetry: () => undefined,
        onDismiss: () => undefined,
      },
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.section).toBe("needs_you");
    expect(items[0]?.status).toBe("failed");
    expect(items[0]?.reason).toBe("Tests failed");
    expect(items[0]?.actions.map((action) => action.kind)).toEqual([
      "open",
      "view-proof",
      "retry",
      "dismiss",
    ]);
    expect(items[0]?.actions.map((action) => action.kind)).not.toContain(
      "approve",
    );
    expect(items[0]?.actions.map((action) => action.kind)).not.toContain(
      "reject",
    );
  });

  it("attaches stop only to running task items", () => {
    const items = taskAttentionItems(
      [
        task({
          column: "building",
          issueNumber: 124,
          title: "Build preview",
        }),
      ],
      { onStop: () => undefined },
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.section).toBe("running");
    expect(items[0]?.actions.map((action) => action.kind)).toContain("stop");
  });

  it("turns degraded health into a needs-you item", () => {
    const items = healthAttentionItems({
      level: "degraded",
      checkedAt: "2026-07-03T09:00:00.000Z",
      signals: [
        {
          id: "token",
          label: "GitHub token",
          level: "degraded",
          detail: "Rate limit is low.",
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "health",
      section: "needs_you",
      status: "waiting",
      title: "GitHub token",
    });
  });
});
