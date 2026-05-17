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
 *   Per-command granularity: the engine stamps a distinct phase label per
 *   command (`fix`→kody:fixing, `fix-ci`→kody:fixing-ci,
 *   `review`→kody:reviewing, `ui-review`→kody:reviewing-ui), so the
 *   action shown here is the exact `@kody` command, not a collapsed
 *   bucket. The ui-verify dedup keys off the same labels — kept in
 *   lockstep (see ui-verify/labels.ts, pipeline-utils.ts).
 */
import type { GitHubIssue, WorkflowRun } from "../types";

export type ActivityAction =
  | "fix"
  | "fix-ci"
  | "sync"
  | "resolve"
  | "review"
  | "ui-review"
  | "run";

const LABEL_TO_ACTION: Record<string, ActivityAction> = {
  "kody:fixing": "fix",
  "kody:fixing-ci": "fix-ci",
  "kody:syncing": "sync",
  "kody:resolving": "resolve",
  "kody:reviewing": "review",
  "kody:reviewing-ui": "ui-review",
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
 * The run↔issue match predicate the dashboard already uses
 * (`matchWorkflowRunToTask`): exact issue-title match, or a `#<number>`
 * reference to the issue in the run's display title.
 */
function runMatchesIssue(run: WorkflowRun, issue: GitHubIssue): boolean {
  const title = run.display_title || "";
  if (title === issue.title) return true;
  return new RegExp(`#${issue.number}(?:\\D|$)`).test(title);
}

/**
 * Build runId → issue number via the shared match predicate, so a run
 * row can deep-link to its task page in the dashboard. Pure — caller
 * supplies the already-fetched arrays.
 */
export function mapRunIssueNumbers(
  runs: WorkflowRun[],
  issues: GitHubIssue[],
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const issue of issues) {
    for (const run of runs) {
      if (runMatchesIssue(run, issue)) out[run.id] = issue.number;
    }
  }
  return out;
}

/**
 * Build runId → action by matching each open issue to its run(s) with the
 * shared predicate. Pure — caller supplies the already-fetched arrays.
 */
export function mapRunActions(
  runs: WorkflowRun[],
  issues: GitHubIssue[],
): Record<number, ActivityAction> {
  const out: Record<number, ActivityAction> = {};
  for (const issue of issues) {
    const action = actionFromLabels(issue.labels.map((l) => l.name));
    if (!action) continue;
    for (const run of runs) {
      if (runMatchesIssue(run, issue)) out[run.id] = action;
    }
  }
  return out;
}
