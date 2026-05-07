/**
 * @fileType utility
 * @domain kody
 * @pattern goal-runtime-state
 * @ai-summary Goal runtime state — separate from the goals manifest. The
 *   manifest (kody:goals-manifest issue) describes goals; this state file
 *   tracks whether a goal is being actively driven by the engine. One file
 *   per goal at `.kody/goals/<id>/state.json` keeps engine and dashboard
 *   writes from racing on the manifest, and matches the per-entity-file
 *   convention the engine uses for missions.
 */

export type GoalRunStateValue = 'active' | 'paused' | 'done'

export interface GoalRunState {
  /** Schema version. Bump on incompatible changes. */
  version: 1
  /** Current run state. */
  state: GoalRunStateValue
  /** ISO timestamp the goal first entered `active`. */
  startedAt: string
  /** ISO timestamp of the last write. */
  updatedAt: string
  /** Optional human-readable reason for `paused`. */
  pausedReason?: string
  /**
   * ISO timestamp the goal entered `done`. Set by `goal-tick` (Phase 2)
   * when every issue with the goal label is closed. Optional today —
   * dashboard never writes this.
   */
  completedAt?: string
}

/** Repo path for a goal's state file. */
export function goalStatePath(goalId: string): string {
  if (!goalId || /[\\/]/.test(goalId)) {
    throw new Error(`Invalid goalId for state path: ${JSON.stringify(goalId)}`)
  }
  return `.kody/goals/${goalId}/state.json`
}

export function makeInitialActiveState(now = new Date()): GoalRunState {
  const iso = now.toISOString()
  return { version: 1, state: 'active', startedAt: iso, updatedAt: iso }
}
