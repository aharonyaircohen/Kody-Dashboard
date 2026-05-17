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
      runNumber: r.run_number ?? null,
      actor: r.actor ?? null,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const queued = runs.filter((r) => r.status === "queued").length;
  const inProgress = runs.filter((r) => r.status === "in_progress").length;
  const completed = runs.filter((r) => r.status === "completed");
  const succeeded = completed.filter(
    (r) => r.conclusion === "success",
  ).length;
  const failed = completed.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
  ).length;

  const last15m = runs.filter(
    (r) => now - new Date(r.createdAt).getTime() <= FIFTEEN_MIN_MS,
  );
  const byTrigger: Record<string, number> = {};
  for (const r of last15m) {
    byTrigger[r.trigger] = (byTrigger[r.trigger] ?? 0) + 1;
  }

  const signals: ActivitySignals = {
    queueDepth: queued + inProgress,
    queued,
    inProgress,
    completed: completed.length,
    succeeded,
    failed,
    runsLast15m: last15m.length,
    medianDurationSec: median(completed.map((r) => r.durationSec)),
    byTrigger,
  };

  return {
    signals,
    alert: deriveActivityAlert(signals),
    runs,
    computedAt: new Date(now).toISOString(),
  };
}
