/**
 * Tests for the action join — deriving the @kody action from an issue's
 * kody:* label and mapping it onto the runs that reference that issue.
 * Locks in the per-command granularity (fix-ci→fix-ci,
 * ui-review→ui-review, distinct from fix/review) and the run↔issue
 * matching predicate.
 */
import { describe, expect, it } from "vitest";
import {
  actionFromLabels,
  mapRunActions,
} from "@dashboard/lib/activity/action";
import type { GitHubIssue, WorkflowRun } from "@dashboard/lib/types";

function issue(over: Partial<GitHubIssue>): GitHubIssue {
  return {
    number: 1,
    title: "Do the thing",
    labels: [],
    milestone: null,
    ...over,
  } as GitHubIssue;
}

function run(over: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: Math.floor(Math.random() * 1e9),
    status: "completed",
    conclusion: "success",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    html_url: "https://x/1",
    display_title: "Do the thing",
    ...over,
  };
}

describe("actionFromLabels", () => {
  it("maps known kody:* phase labels to actions", () => {
    expect(actionFromLabels(["kody:fixing"])).toBe("fix");
    expect(actionFromLabels(["kody:fixing-ci"])).toBe("fix-ci");
    expect(actionFromLabels(["kody:syncing"])).toBe("sync");
    expect(actionFromLabels(["kody:resolving"])).toBe("resolve");
    expect(actionFromLabels(["kody:reviewing"])).toBe("review");
    expect(actionFromLabels(["kody:reviewing-ui"])).toBe("ui-review");
  });

  it("returns null when no phase label present", () => {
    expect(actionFromLabels(["bug", "P2"])).toBeNull();
  });
});

describe("mapRunActions", () => {
  it("joins by exact title and by #number reference", () => {
    const runs = [
      run({ id: 1, display_title: "Do the thing" }), // exact title
      run({ id: 2, display_title: "fix #42 fallout" }), // #number
      run({ id: 3, display_title: "unrelated #420" }), // must NOT match #42
    ];
    const issues = [
      issue({
        number: 42,
        title: "Do the thing",
        labels: [{ name: "kody:fixing", color: "x" }],
      }),
    ];
    const map = mapRunActions(runs, issues);
    expect(map[1]).toBe("fix");
    expect(map[2]).toBe("fix");
    expect(map[3]).toBeUndefined();
  });

  it("ignores issues with no actionable label", () => {
    const map = mapRunActions(
      [run({ id: 9, display_title: "x" })],
      [issue({ number: 1, title: "x", labels: [{ name: "bug", color: "y" }] })],
    );
    expect(map[9]).toBeUndefined();
  });
});
