import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { tasksApi } from "@dashboard/lib/api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODY_DASHBOARD_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/KodyDashboard.tsx"),
  "utf8",
);

describe("tasks API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send browser actor login when starting a task", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await tasksApi.execute(123, "stale-browser-login");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/kody/tasks/issue-123/start");
    expect(JSON.parse(String(init?.body))).toEqual({});
  });

  it("does not pass cached actor login through the task-page run mutation", () => {
    const executeMutationBlock = KODY_DASHBOARD_SOURCE.match(
      /const executeMutation = useMutation\(\{[\s\S]*?\n  \}\);/,
    );

    expect(executeMutationBlock).not.toBeNull();
    expect(executeMutationBlock![0]).toContain(
      "tasksApi.execute(task.issueNumber)",
    );
    expect(executeMutationBlock![0]).not.toContain("githubUser?.login");
  });

  it("does not compose the backlog-label action in the task-page run mutation", () => {
    const executeMutationBlock = KODY_DASHBOARD_SOURCE.match(
      /const executeMutation = useMutation\(\{[\s\S]*?\n  \}\);/,
    );

    expect(executeMutationBlock).not.toBeNull();
    expect(executeMutationBlock![0]).not.toContain("kodyApi.tasks.addLabel");
  });

  it("surfaces the backend start failure message in the task-page toast", () => {
    const executeMutationBlock = KODY_DASHBOARD_SOURCE.match(
      /const executeMutation = useMutation\(\{[\s\S]*?\n  \}\);/,
    );

    expect(executeMutationBlock).not.toBeNull();
    expect(executeMutationBlock![0]).toContain(
      'mutationErrorMessage(error, "Failed to start task")',
    );
  });
});
