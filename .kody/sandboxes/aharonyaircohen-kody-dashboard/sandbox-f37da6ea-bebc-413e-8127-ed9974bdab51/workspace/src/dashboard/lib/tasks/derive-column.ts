/**
 * @fileType pure
 * @domain tasks
 * @pattern column-derivation
 * @ai-summary Pure column derivation — decides which dashboard lane (open/building/review/done/failed/...) a task belongs to.
 *
 * Extracted from app/api/kody/tasks/route.ts so the priority rules can be
 * unit-tested in isolation. Three sources feed the decision:
 *   1. issue state + labels (slow-changing, eventually consistent)
 *   2. workflow run (may be a stray match — title/issue-number based)
 *   3. engine kodyState comment (canonical, written by the engine itself)
 *
 * The engine state is preferred over a "stray active run" — a recent bug
 * report had completed tasks flapping back to "building" because an
 * unrelated workflow run matched the issue by `#N` substring. See
 * tests/unit/derive-column.spec.ts for the regression case.
 */

import type { KodyTaskState } from "../kody-state";
import type {
  ColumnId,
  GitHubIssue,
  GitHubPR,
  KodyPipelineStatus,
  WorkflowRun,
} from "../types";

export interface DeriveColumnInput {
  issue: GitHubIssue;
  workflowRun?: WorkflowRun | null;
  associatedPR?: GitHubPR | null;
  kodyState?: KodyTaskState | null;
  pipelineStatus?: KodyPipelineStatus | null;
}

/**
 * Derive column from live pipeline status. Pipeline state is more accurate
 * than GitHub labels (no propagation delay).
 */
export function deriveColumnFromPipeline(
  pipeline: KodyPipelineStatus,
): ColumnId {
  switch (pipeline.state) {
    case "running":
      return "building";
    case "paused":
      return "gate-waiting";
    case "completed":
      return "review";
    case "failed":
    case "timeout":
      return "failed";
    default:
      return "building";
  }
}

/**
 * Map GitHub issue → column from labels, workflow runs, and PR status.
 * Used when no live pipeline data is available. Priority documented inline.
 */
export function getColumnForIssue(
  issue: GitHubIssue,
  workflowRun?: WorkflowRun,
  associatedPR?: GitHubPR | null,
  kodyState?: KodyTaskState | null,
): ColumnId {
  const labelNames = issue.labels.map((l) => l.name.toLowerCase());

  if (kodyState) {
    const { phase, status } = kodyState.core;
    if (phase === "shipped") return "done";
    if (status === "failed" || phase === "failed") return "failed";
    if (status === "running") {
      if (phase === "reviewing" && (associatedPR || kodyState.core.prUrl))
        return "review";
      // `idle` is the parked phase — classified but no working phase started,
      // or a phase ended without finalizing. It is NOT active work. Returning
      // "building" here makes backlog issues flap into "running" whenever this
      // stale state happens to be read (kodyState is only fetched when the old
      // run is still in the recent-runs window, which churns minute-to-minute).
      // Fall through: a genuinely live run is still caught by the in_progress
      // check below; otherwise the issue settles into its label/PR lane.
      if (phase !== "idle") return "building";
    }
    if (status === "succeeded") {
      if (associatedPR && !associatedPR.merged_at) return "review";
      if (associatedPR?.merged_at) return "done";
      return "building";
    }
  }

  if (
    workflowRun?.status === "in_progress" ||
    workflowRun?.status === "queued"
  ) {
    return "building";
  }

  if (labelNames.includes("kody:failed")) return "failed";
  if (labelNames.includes("kody:done")) return "done";

  if (
    labelNames.includes("kody:reviewing") ||
    labelNames.includes("kody:reviewing-ui")
  )
    return "review";

  if (
    labelNames.includes("kody:building") ||
    labelNames.includes("kody:classifying") ||
    labelNames.includes("kody:researching") ||
    labelNames.includes("kody:planning") ||
    labelNames.includes("kody:running") ||
    labelNames.includes("kody:fixing") ||
    labelNames.includes("kody:fixing-ci") ||
    labelNames.includes("kody:resolving") ||
    labelNames.includes("kody:syncing") ||
    labelNames.includes("kody:orchestrating")
  ) {
    return "building";
  }

  if (labelNames.includes("failed")) return "failed";
  if (labelNames.includes("gate-waiting")) return "gate-waiting";
  if (labelNames.includes("retrying")) return "retrying";

  if (workflowRun?.status === "completed") {
    if (
      workflowRun.conclusion === "failure" ||
      workflowRun.conclusion === "timed_out" ||
      workflowRun.conclusion === "cancelled"
    )
      return "failed";
  }

  if (associatedPR && !associatedPR.merged_at) {
    const prLabels = (associatedPR.labels ?? []).map((l) => l.toLowerCase());
    const prMidFlow = prLabels.some(
      (l) =>
        l === "kody:fixing" ||
        l === "kody:fixing-ci" ||
        l === "kody:syncing" ||
        l === "kody:resolving" ||
        l === "kody:building" ||
        l === "kody:running" ||
        l === "kody:planning" ||
        l === "kody:classifying" ||
        l === "kody:researching" ||
        l === "kody:orchestrating",
    );
    if (prMidFlow) return "building";
    return "review";
  }

  if (labelNames.includes("released")) return "done";
  if (labelNames.includes("in-progress") || labelNames.includes("building"))
    return "building";
  if (labelNames.includes("review") || labelNames.includes("pr"))
    return "review";

  return "open";
}

/**
 * Orchestrates the three signals into a final column. This is the
 * load-bearing decision — it determines which lane the user sees on the
 * dashboard. Order matters; keep tests in tests/unit/derive-column.spec.ts
 * in sync with any change here.
 */
export function deriveTaskColumn(input: DeriveColumnInput): ColumnId {
  const { issue, workflowRun, associatedPR, kodyState, pipelineStatus } = input;

  if (issue.state === "closed") return "done";

  // Canonical engine state wins over a stray active workflow run.
  // Without this guard, an unrelated run whose display_title contains
  // `#<issueNumber>` or the taskId can flip a shipped task back to
  // "building" until the next poll — visible to users as a task randomly
  // jumping between completed and running.
  if (kodyState?.core.phase === "shipped") return "done";
  if (
    kodyState?.core.phase === "failed" ||
    kodyState?.core.status === "failed"
  ) {
    return "failed";
  }

  const hasActiveRun =
    workflowRun?.status === "in_progress" || workflowRun?.status === "queued";

  const pipelineLooksStale =
    !!pipelineStatus &&
    (pipelineStatus.state === "completed" ||
      pipelineStatus.state === "failed" ||
      pipelineStatus.state === "timeout") &&
    hasActiveRun;

  if (pipelineStatus && !pipelineLooksStale) {
    return deriveColumnFromPipeline(pipelineStatus);
  }
  if (pipelineLooksStale) return "building";

  return getColumnForIssue(
    issue,
    workflowRun ?? undefined,
    associatedPR ?? null,
    kodyState ?? null,
  );
}
