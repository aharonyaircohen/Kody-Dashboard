/**
 * @testFramework vitest
 * @domain unit
 *
 * TaskDetail is hook-heavy, so this pins the source-level contract used by the
 * existing TaskDetail structural tests: run controls must not depend only on
 * `task.pipeline`, because early/preflight runs and fresh active runs can lack a
 * parsed status artifact.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_DETAIL_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/TaskDetail.tsx",
);

const SOURCE = readFileSync(TASK_DETAIL_PATH, "utf8");

describe("TaskDetail run actions", () => {
  it("shows Stop from derived active task signals, not only pipeline state", () => {
    expect(SOURCE).toMatch(/function isTaskAbortable\(task: KodyTask\)/);
    expect(SOURCE).toMatch(/task\.workflowRun\?\.status === "in_progress"/);
    expect(SOURCE).toMatch(/task\.workflowRun\?\.status === "queued"/);
    expect(SOURCE).toMatch(/task\.column === "building"/);
    expect(SOURCE).toMatch(
      /if \(isTaskAbortable\(task\)\) \{[\s\S]*?label: "Stop"/,
    );
  });

  it("shows Rerun for completed or failed run history when the task is not active", () => {
    expect(SOURCE).toMatch(/function hasTaskRunHistory\(task: KodyTask\)/);
    expect(SOURCE).toMatch(/task\.column === "failed"/);
    expect(SOURCE).toMatch(/task\.column === "review"/);
    expect(SOURCE).toMatch(/task\.column === "done"/);
    expect(SOURCE).toMatch(
      /if \(!isTaskAbortable\(task\) && hasTaskRunHistory\(task\)\) \{[\s\S]*?label: "Rerun"/,
    );
  });
});
