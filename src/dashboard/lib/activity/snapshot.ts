/**
 * @fileType utility
 * @domain kody
 * @pattern activity-snapshot
 * @ai-summary Pure: fold a list of WorkflowRun into the Activity snapshot
 *   (signals + alert + normalized runs). No I/O — the route fetches via
 *   the cached fetchWorkflowRuns and hands the array here. Pure so it's
 *   unit-testable and reusable.
 */
import type { WorkflowRun } from "../types";
import { categorizeRun } from "./categorize";
import {
  type ActivityRun,
  type ActivitySignals,
  type ActivitySnapshot,
  deriveActivityAlert,
} from "./types";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function durationSec(run: WorkflowRun, now: number): number {
  const start = new Date(run.created_at).getTime();
  const end =
    run.status === "completed"
      ? new Date(run.updated_at).getTime()
      : now;
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 1000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export function buildActivitySnapshot(
  workflowRuns: WorkflowRun[],
  now: number = Date.now(),
  runActions: Record<number, import("./action").ActivityAction> = {},
  runIssues: Record<number, number> = {},
): ActivitySnapshot {
  const runs: ActivityRun[] = workflowRuns
    .map((r) => ({
      id: r.id,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      durationSec: durationSec(r, now),
      htmlUrl: r.html_url,
      title: r.display_title?.trim() || `Run ${r.id}`,
      branch: r.head_branch ?? null,
      trigger: r.event?.trim() || "unknown",
      category: categorizeRun(r.event, r.display_title),
      action: runActions[r.id] ?? null,
      taskNumber: runIssues[r.id] ?? null,
      runNumber: r.run_number ?? null,
      actor: r.actor ?? null,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  // `skipped`/`cancelled` runs are not real work: skipped = kody.yml
  // re-triggering on its own progress comments and short-circuiting via a
  // guard; cancelled = concurrency superseding. Counting them turns a
  // normal burst into a false "trigger loop" alarm. Signals derive from
  // real runs only — same stance matchWorkflowRunToTask already takes.
  // They stay in `runs` so the operator can still see them.
  const isNoise = (r: ActivityRun) =>
    r.status === "completed" &&
    (r.conclusion === "skipped" || r.conclusion === "cancelled");
  const realRuns = runs.filter((r) => !isNoise(r));

  const queued = realRuns.filter((r) => r.status === "queued").length;
  const inProgress = realRuns.filter(
    (r) => r.status === "in_progress",
  ).length;
  const completed = realRuns.filter((r) => r.status === "completed");
  const succeeded = completed.filter(
    (r) => r.conclusion === "success",
  ).length;
  const failed = completed.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
  ).length;

  const within15m = (r: ActivityRun) =>
    now - new Date(r.createdAt).getTime() <= FIFTEEN_MIN_MS;
  const last15m = realRuns.filter(within15m);
  const noiseLast15m = runs.filter(
    (r) => isNoise(r) && within15m(r),
  ).length;
  const byTrigger: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  for (const r of last15m) {
    byTrigger[r.trigger] = (byTrigger[r.trigger] ?? 0) + 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    if (r.action) byAction[r.action] = (byAction[r.action] ?? 0) + 1;
  }

  const signals: ActivitySignals = {
    queueDepth: queued + inProgress,
    queued,
    inProgress,
    completed: completed.length,
    succeeded,
    failed,
    runsLast15m: last15m.length,
    noiseLast15m,
    medianDurationSec: median(completed.map((r) => r.durationSec)),
    byTrigger,
    byCategory,
    byAction,
  };

  return {
    signals,
    alert: deriveActivityAlert(signals),
    runs,
    computedAt: new Date(now).toISOString(),
  };
}
