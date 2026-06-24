/**
 * @fileType utility
 * @domain kody
 * @pattern goal-runtime-state
 * @ai-summary Goal runtime state — separate from the goals manifest. The
 *   manifest (kody:goals-manifest issue) describes goals; this state file
 *   tracks whether a goal is being actively driven by the engine. One file
 *   per goal at `<statePath>/goals/instances/<id>/state.json` keeps engine and dashboard
 *   writes from racing on the manifest, and matches the per-entity-file
 *   convention the engine uses for agentResponsibilities.
 */

/**
 * `awaiting-merge`: every task is complete but the cumulative goal diff
 * has NOT been merged. The engine parks here instead of auto-merging.
 * The dashboard never *writes* this value (the engine sets it); it only
 * reads it to show the "Merge goal" button. Clicking Merge flips the
 * goal back to `active` with `mergeApproved`, which lets the engine's
 * existing finalize squash-merge the leaf once.
 */
export type GoalRunStateValue = "active" | "paused" | "awaiting-merge" | "done";

export interface GoalRunState {
  /** Schema version. Bump on incompatible changes. */
  version: 1;
  /** Current run state. */
  state: GoalRunStateValue;
  /** ISO timestamp the goal first entered `active`. */
  startedAt: string;
  /** ISO timestamp of the last write. */
  updatedAt: string;
  /** Optional human-readable reason for `paused`. */
  pausedReason?: string;
  /**
   * DEPRECATED. The engine no longer auto-merges, so this flag is inert.
   * Kept only so legacy state files round-trip without a parse error.
   */
  mergeApproved?: boolean;
  /**
   * "Let Kody manage this goal end-to-end." When true, the `goal-manager`
   * agent (`.kody/agents/goal-manager.md`) picks the goal up: decomposes
   * it into task issues, lets `goal-tick` execute them, verifies the
   * end-to-end journey with `qa-engineer`, recovers stalls, and leaves a
   * single open deliverable PR for a human to merge. Absent/false → the
   * agent ignores the goal entirely. Written only by the dashboard's
   * `/goals/<id>/manage` endpoint; the engine/agents only reads it.
   */
  managed?: boolean;
  /**
   * ISO timestamp the goal entered `done`. Set by `goal-tick` (Phase 2)
   * when every issue with the goal label is closed. Optional today —
   * dashboard never writes this.
   */
  completedAt?: string;
  /**
   * Engine-owned bookkeeping fields (stacked-PR model writes `state`,
   * `lastDispatchedIssue`, `updatedAt`; older repos may still have legacy
   * fields like `goalIssueNumber`/`goalPrUrl`/`completedAt`). The
   * dashboard does not interpret these but MUST round-trip them on
   * writes — the engine preserves unknown fields through its `extra`
   * passthrough, so a write that drops them silently is the dashboard's
   * fault. Passthrough rather than enumerated keeps future engine fields
   * working without a dashboard release.
   */
  [extraField: string]: unknown;
}

/** Repo path for a goal's state file. */
export function goalStatePath(goalId: string): string {
  if (!goalId || /[\\/]/.test(goalId)) {
    throw new Error(`Invalid goalId for state path: ${JSON.stringify(goalId)}`);
  }
  return `goals/instances/${goalId}/state.json`;
}

export function makeInitialActiveState(now = new Date()): GoalRunState {
  const iso = now.toISOString();
  return { version: 1, state: "active", startedAt: iso, updatedAt: iso };
}

export const SIMPLE_COMPANY_GOAL_TYPE = "simple";
export const SIMPLE_COMPANY_GOAL_EVIDENCE = "labelledTasksComplete";

/**
 * Company-store simple goal: legacy dashboard behavior via `goal:<id>` task
 * labels rather than a routed managed-goal workflow.
 */
export function makeInitialSimpleGoalState(
  goalId: string,
  now = new Date(),
): GoalRunState {
  return {
    ...makeInitialActiveState(now),
    type: SIMPLE_COMPANY_GOAL_TYPE,
    sourceTemplate: SIMPLE_COMPANY_GOAL_TYPE,
    description:
      "Legacy dashboard goal: group tasks by goal label and let the existing goal runner close when labelled tasks are done.",
    destination: {
      outcome: `Tasks labelled goal:${goalId} are complete.`,
      evidence: [SIMPLE_COMPANY_GOAL_EVIDENCE],
    },
    agentResponsibilities: [],
    route: [],
    stage: "waiting",
    facts: {
      simpleAttachedTaskCount: 0,
      simpleOpenTaskCount: 0,
      [SIMPLE_COMPANY_GOAL_EVIDENCE]: false,
    },
    blockers: [],
  };
}

/**
 * Short relative-time formatter for the runner's `updatedAt`. Returns
 * strings like "just now", "3m ago", "2h ago", "5d ago". Pure — no
 * locale, no Intl.RelativeTimeFormat — because the strings are tiny and
 * dependency-free is more valuable here than perfect i18n.
 */
export function formatTickAge(
  updatedAt: string,
  now: Date = new Date(),
): string {
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return "";
  const ms = Math.max(0, now.getTime() - then);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
