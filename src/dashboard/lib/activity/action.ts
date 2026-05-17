/**
 * @fileType utility
 * @domain kody
 * @pattern activity-action
 * @ai-summary Pure: derive the @kody action behind a run by joining it to
 *   its issue's existing kody:* phase label. No engine change and no extra
 *   per-issue calls — the dashboard already fetches the open-issue list
 *   (cached/ETagged) and each issue carries the label the engine stamps
 *   when an executable starts.
 *
 *   Granularity ceiling (by design): `fix`/`fix-ci` both stamp
 *   `kody:fixing` and `review`/`ui-review` both stamp `kody:reviewing` in
 *   the engine, so they collapse to `fix` / `review` here. Splitting them
 *   would ripple into the dashboard's ui-verify dedup — a separate,
 *   deliberate engine task, not inferred here.
 */
import type { GitHubIssue, WorkflowRun } from "../types";

export type ActivityAction = "fix" | "sync" | "resolve" | "review" | "run";

const LABEL_TO_ACTION: Record<string, ActivityAction> = {
  "kody:fixing": "fix",
  "kody:syncing": "sync",
  "kody:resolving": "resolve",
  "kody:reviewing": "review",
  "kody:running": "run",
  "kody:building": "run",
};

export function actionFromLabels(
  labelNames: readonly string[],
): ActivityAction | null {
  for (const l of labelNames) {
    const hit = LABEL_TO_ACTION[l.toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

/**
 * Build runId → action by matching each open issue to its run(s) with the
 * same predicate the dashboard already uses (`matchWorkflowRunToTask`):
 * exact issue-title match or a `#<number>` reference in the run's
 * display title. Pure — caller supplies the already-fetched arrays.
 */
export function mapRunActions(
  runs: WorkflowRun[],
  issues: GitHubIssue[],
): Record<number, ActivityAction> {
  const out: Record<number, ActivityAction> = {};
  for (const issue of issues) {
    const action = actionFromLabels(issue.labels.map((l) => l.name));
    if (!action) continue;
    const numRe = new RegExp(`#${issue.number}(?:\\D|$)`);
    for (const run of runs) {
      const title = run.display_title || "";
      if (title === issue.title || numRe.test(title)) {
        out[run.id] = action;
      }
    }
  }
  return out;
}
