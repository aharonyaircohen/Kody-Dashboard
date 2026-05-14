/**
 * @fileType utility
 * @domain kody
 * @pattern utilities
 * @ai-summary Utility functions for Kody dashboard
 */

// Re-export cn from infra/utils/ui (uses tailwind-merge for proper class merging)
export { cn } from '@dashboard/lib/utils/ui'

/**
 * Format duration in ms to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

/**
 * Format date to relative time
 */
export function formatRelativeTime(date: string | Date): string {
  const now = new Date()
  const then = new Date(date)
  const diff = now.getTime() - then.getTime()

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return then.toLocaleDateString()
}

// ============ View Mode Filtering ============

import type { KodyTask, SortField, SortDirection } from './types'
import type { ViewMode } from './components/FilterBar'
import { COLUMN_DEFS, getTaskPriority, PRIORITY_RANK } from './constants'

export interface ViewModeFilterOptions {
  viewMode: ViewMode
  statusFilter: string
  labelFilter: string
  priorityFilter: string
  /**
   * When true, skip the running/backlog split — show all non-terminal tasks.
   * Used in goal-grouped view, where the running/backlog distinction is
   * collapsed and every active task is visible under its goal section.
   */
  showAllStates?: boolean
}

/**
 * Filter tasks by view mode, then by status and label (combined with AND logic).
 * - 'running' view: excludes tasks in 'open' column
 * - 'backlog' view: only tasks in 'open' column
 * - showAllStates=true: skip the running/backlog split entirely
 * Status and label filters apply within the selected view.
 */

// Queue labels
export const QUEUE_LABELS = ['kody:queued', 'kody:queue-active', 'kody:queue-failed'] as const

/**
 * Closed tasks are terminal — they don't belong in Running or Backlog.
 *
 * Why state-only (no `column === 'done'` check): an issue can carry a
 * `kody:done` label (so column derives to 'done') while still being open
 * on GitHub — e.g. release tracking issues that the engine marks done
 * but never closes. Those should stay visible until the issue is actually
 * closed. Past regression (commit 0d02d82) added the column check to keep
 * closed-but-stale-column tasks out of Running, but the route already
 * short-circuits closed issues to column='done', so the state-only guard
 * is sufficient and avoids over-hiding open-but-marked-done issues.
 */
function isTerminalTask(task: KodyTask): boolean {
  return task.state === 'closed'
}

export function filterTasksByView(tasks: KodyTask[], options: ViewModeFilterOptions): KodyTask[] {
  const { viewMode, statusFilter, labelFilter, priorityFilter, showAllStates } = options
  return tasks.filter((task) => {
    // View mode filter — primary split
    if (viewMode === 'queue' && !showAllStates) {
      return task.labels.some((l) => QUEUE_LABELS.includes(l as (typeof QUEUE_LABELS)[number]))
    }
    if (showAllStates) {
      // Goal view: every active task is visible, terminal tasks still hidden.
      if (isTerminalTask(task)) return false
    } else if (viewMode === 'backlog') {
      if (isTerminalTask(task)) return false
      if (task.column !== 'open') return false
    } else if (viewMode === 'running') {
      if (isTerminalTask(task)) return false
      if (task.column === 'open') return false
    }
    // Status filter
    if (statusFilter !== 'all' && task.column !== statusFilter) return false
    // Label filter
    if (labelFilter !== 'all' && !task.labels.includes(labelFilter)) return false
    // Priority filter
    if (priorityFilter !== 'all' && !task.labels.includes(`priority:${priorityFilter}`))
      return false
    return true
  })
}

/**
 * Compute view mode counts from task list.
 * Backlog = open-column non-terminal tasks. Running = everything else that's
 * still active (terminal/closed tasks are excluded from both counts so they
 * match what {@link filterTasksByView} actually shows).
 */
export function getViewModeCounts(tasks: KodyTask[]): {
  runningCount: number
  backlogCount: number
  queueCount: number
} {
  const active = tasks.filter((t) => !isTerminalTask(t))
  const backlogCount = active.filter((t) => t.column === 'open').length
  const queueCount = tasks.filter((t) =>
    t.labels.some((l) => QUEUE_LABELS.includes(l as (typeof QUEUE_LABELS)[number])),
  ).length
  return {
    backlogCount,
    runningCount: active.length - backlogCount,
    queueCount,
  }
}

// ============ Sorting ============

const RISK_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
  undefined: 3,
}

/**
 * Sort tasks by a specific field and direction.
 * Returns a new sorted array (immutable).
 */
export function sortTasks(
  tasks: KodyTask[],
  field: SortField,
  direction: SortDirection,
): KodyTask[] {
  const sorted = [...tasks].sort((a, b) => {
    let cmp = 0

    switch (field) {
      case 'updatedAt':
        cmp = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        break
      case 'createdAt':
        cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        break
      case 'issueNumber':
        cmp = b.issueNumber - a.issueNumber
        break
      case 'column':
        cmp = (COLUMN_DEFS[a.column]?.order ?? 0) - (COLUMN_DEFS[b.column]?.order ?? 0)
        break
      case 'riskLevel': {
        const aRisk = a.taskDefinition?.risk_level ?? 'undefined'
        const bRisk = b.taskDefinition?.risk_level ?? 'undefined'
        cmp = (RISK_ORDER[aRisk] ?? 3) - (RISK_ORDER[bRisk] ?? 3)
        break
      }
      case 'pipelineProgress': {
        const aStages = a.pipeline?.stages ?? {}
        const bStages = b.pipeline?.stages ?? {}
        const aCompleted = Object.values(aStages).filter((s) => s.state === 'completed').length
        const bCompleted = Object.values(bStages).filter((s) => s.state === 'completed').length
        cmp = bCompleted - aCompleted
        break
      }
      case 'assignee': {
        const aAssignee = a.assignees?.[0]?.login ?? ''
        const bAssignee = b.assignees?.[0]?.login ?? ''
        cmp = aAssignee.localeCompare(bAssignee)
        break
      }
      case 'title':
        cmp = a.title.localeCompare(b.title)
        break
      case 'label': {
        const aLabel = a.labels?.[0] ?? ''
        const bLabel = b.labels?.[0] ?? ''
        cmp = aLabel.localeCompare(bLabel)
        break
      }
      case 'priority': {
        const aPri = getTaskPriority(a.labels)
        const bPri = getTaskPriority(b.labels)
        const aRank = aPri ? (PRIORITY_RANK[aPri] ?? 99) : 99
        const bRank = bPri ? (PRIORITY_RANK[bPri] ?? 99) : 99
        cmp = aRank - bRank
        break
      }
      default:
        cmp = 0
    }

    return direction === 'asc' ? -cmp : cmp
  })

  return sorted
}

// ============ Vercel Preview Bypass ============

/**
 * Create an iframe-friendly URL for Vercel preview deployments.
 * Reads the per-user bypass secret from kody_auth in localStorage (set on the
 * login page). Returns the URL untouched when no secret is configured — the
 * iframe will then redirect to Vercel's login.
 */
export function getPreviewBypassUrl(previewUrl: string | undefined | null): string | null {
  if (!previewUrl) return null
  if (typeof window === 'undefined') return previewUrl

  let bypassSecret: string | undefined
  try {
    const raw = window.localStorage.getItem('kody_auth')
    if (raw) {
      const parsed = JSON.parse(raw) as { vercelBypassSecret?: unknown }
      if (typeof parsed.vercelBypassSecret === 'string' && parsed.vercelBypassSecret.trim()) {
        bypassSecret = parsed.vercelBypassSecret.trim()
      }
    }
  } catch {
    // Malformed kody_auth — fall through to the no-secret path.
  }

  if (!bypassSecret) return previewUrl

  try {
    const url = new URL(previewUrl)
    url.searchParams.set('x-vercel-protection-bypass', bypassSecret)
    url.searchParams.set('x-vercel-set-bypass-cookie', 'samesitenone')
    return url.toString()
  } catch (error) {
    console.warn('[Kody] Invalid preview URL, cannot add bypass params:', previewUrl, error)
    return previewUrl
  }
}
