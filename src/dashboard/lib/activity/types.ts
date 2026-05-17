/**
 * @fileType utility
 * @domain kody
 * @pattern activity-types
 * @ai-summary Shared shapes for the Engine Activity view — the read-only
 *   health panel over kody.yml workflow runs. Computed server-side from
 *   the already-cached `fetchWorkflowRuns` data so the page adds no extra
 *   GitHub API budget (see CLAUDE.md rate-limit rules).
 */

export type ActivityRunStatus = "queued" | "in_progress" | "completed";

export interface ActivityRun {
  id: number;
  status: ActivityRunStatus;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  /** Seconds: wall-clock for completed runs, elapsed-so-far for live ones. */
  durationSec: number;
  htmlUrl: string;
  title: string;
  branch: string | null;
  /** GitHub trigger event (schedule, issue_comment, workflow_dispatch, …). */
  trigger: string;
  /** Coarse bucket derived from trigger+title (see categorize.ts). */
  category: import("./categorize").ActivityCategory;
  runNumber: number | null;
  actor: string | null;
}

export interface ActivitySignals {
  /** queued + in_progress — a jam shows here. */
  queueDepth: number;
  queued: number;
  inProgress: number;
  completed: number;
  succeeded: number;
  failed: number;
  /** Runs created in the last 15 minutes — a flood detector. */
  runsLast15m: number;
  /** Median completed-run duration (seconds), or null if none completed. */
  medianDurationSec: number | null;
  /**
   * Count of runs created in the last 15 min, grouped by trigger event.
   * A lopsided bucket (e.g. issue_comment: 28) names a trigger loop.
   */
  byTrigger: Record<string, number>;
  /** Last-15m run counts grouped by coarse category. */
  byCategory: Record<string, number>;
}

export interface ActivityAlert {
  level: "ok" | "warn" | "critical";
  message: string;
}

export interface ActivitySnapshot {
  signals: ActivitySignals;
  alert: ActivityAlert;
  runs: ActivityRun[];
  /** ISO time the snapshot was computed (server clock). */
  computedAt: string;
}

/** A jam/flood is unmistakable past these — tuned off the 984-comment incident. */
export const ACTIVITY_QUEUE_WARN = 5;
export const ACTIVITY_QUEUE_CRITICAL = 15;
export const ACTIVITY_FLOOD_WARN = 8;
export const ACTIVITY_FLOOD_CRITICAL = 20;

export function deriveActivityAlert(s: ActivitySignals): ActivityAlert {
  if (
    s.queueDepth >= ACTIVITY_QUEUE_CRITICAL ||
    s.runsLast15m >= ACTIVITY_FLOOD_CRITICAL
  ) {
    return {
      level: "critical",
      message: `${s.queueDepth} runs queued · ${s.runsLast15m} created in the last 15 min — likely a trigger loop. Find what's posting and stop it.`,
    };
  }
  if (
    s.queueDepth >= ACTIVITY_QUEUE_WARN ||
    s.runsLast15m >= ACTIVITY_FLOOD_WARN
  ) {
    return {
      level: "warn",
      message: `Engine is busier than usual (${s.queueDepth} queued, ${s.runsLast15m} in 15 min). Keep an eye on it.`,
    };
  }
  return { level: "ok", message: "Engine healthy — no backlog or flood." };
}
