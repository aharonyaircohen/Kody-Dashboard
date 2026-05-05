/**
 * @fileType utility
 * @domain kody
 * @pattern workflow-matching
 * @ai-summary Shared workflow run matching — prefers active (in_progress/queued) runs over stale completed ones
 */

import type { WorkflowRun } from './types'

/**
 * Match the best workflow run for a given task.
 *
 * Matching strategy:
 * 1. Collect candidate runs by display_title (exact match), issue number reference, or taskId.
 * 2. Prefer active runs: in_progress > queued > most-recent completed.
 * 3. Returns undefined when no candidate matches (no weak html_url fallback to avoid false positives).
 *
 * @param runs       All workflow runs (sorted by created_at desc from GitHub API)
 * @param issueTitle The full issue title (used for exact display_title match)
 * @param issueNumber The GitHub issue number (used for "#NNN" reference matching)
 * @param taskId     The pipeline task ID (e.g., "260315-auto-839")
 */
export function matchWorkflowRunToTask(
  runs: WorkflowRun[],
  issueTitle: string,
  issueNumber: number,
  taskId: string,
): WorkflowRun | undefined {
  // Pre-compile regex for issue number matching with word boundary
  // Matches "#839" followed by non-digit or end-of-string (avoids #8 matching #839)
  const issueRegex = issueNumber > 0 ? new RegExp(`#${issueNumber}(?:\\D|$)`) : null

  // 1. Collect ALL candidate runs matching this task
  const candidates = runs.filter((run) => {
    const title = run.display_title || ''

    // Exact issue title match (most reliable for issue_comment triggers)
    if (issueTitle && title === issueTitle) return true

    // Issue number reference in display_title (e.g., "#839" but not "#8390")
    if (issueRegex && issueRegex.test(title)) return true

    // TaskId in display_title (e.g., "260315-auto-839")
    if (taskId && title.includes(taskId)) return true

    return false
  })

  if (candidates.length === 0) {
    return undefined
  }

  // 2. Prefer active runs over completed — active = currently relevant
  const inProgress = candidates.find((r) => r.status === 'in_progress')
  if (inProgress) return inProgress

  const queued = candidates.find((r) => r.status === 'queued')
  if (queued) return queued

  // 3. Prefer the most recent run that actually executed. Skipped runs come
  //    from the kody workflow re-triggering on its own progress comments and
  //    short-circuiting via a guard — they're noise, not real work.
  const executed = candidates.find((r) => r.conclusion !== 'skipped')
  if (executed) return executed

  // 4. Fall back to first candidate (most recent completed, since runs are sorted desc)
  return candidates[0]
}

/**
 * Return ALL workflow runs that belong to a given task, in the order they were
 * received (GitHub returns newest-first).
 *
 * A run is considered to belong to the task if any of these are true:
 *  - its `head_branch` matches the kody-derived issue branch (`{issueNumber}` or `{issueNumber}-…`)
 *  - its `display_title` exactly equals the issue title
 *  - its `display_title` references `#{issueNumber}` (with non-digit boundary so #8 ≠ #839)
 *  - its `display_title` contains the pipeline `taskId`
 *
 * The branch predicate is the load-bearing one — kody dispatches the workflow
 * with `issue_number` as input and works on a branch derived from it
 * (see kody2/src/branch.ts deriveBranchName), so head_branch is a reliable scope.
 */
export function matchWorkflowRunsForTask(
  runs: WorkflowRun[],
  issueTitle: string,
  issueNumber: number,
  taskId: string,
): WorkflowRun[] {
  const issueRegex = issueNumber > 0 ? new RegExp(`#${issueNumber}(?:\\D|$)`) : null
  const branchRegex =
    issueNumber > 0 ? new RegExp(`^${issueNumber}(?:-|$)`) : null

  return runs.filter((run) => {
    const title = run.display_title || ''
    const branch = run.head_branch || ''

    if (branchRegex && branchRegex.test(branch)) return true
    if (issueTitle && title === issueTitle) return true
    if (issueRegex && issueRegex.test(title)) return true
    if (taskId && title.includes(taskId)) return true

    return false
  })
}
