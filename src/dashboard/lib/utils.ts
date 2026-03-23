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
}

/**
 * Filter tasks by view mode, then by status and label (combined with AND logic).
 * - 'running' view: excludes tasks in 'open' column
 * - 'backlog' view: only tasks in 'open' column
 * Status and label filters apply within the selected view.
 */

// Queue labels
export const QUEUE_LABELS = ['kody:queued', 'kody:queue-active', 'kody:queue-failed'] as const

export function filterTasksByView(tasks: KodyTask[], options: ViewModeFilterOptions): KodyTask[] {
  const { viewMode, statusFilter, labelFilter, priorityFilter } = options
  return tasks.filter((task) => {
    // View mode filter — primary split
    if (viewMode === 'queue') {
      return task.labels.some((l) => QUEUE_LABELS.includes(l as (typeof QUEUE_LABELS)[number]))
    }
    if (viewMode === 'backlog' && task.column !== 'open') return false
    if (viewMode === 'running' && task.column === 'open') return false
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
 * Backlog = tasks in 'open' column. Running = everything else.
 */
export function getViewModeCounts(tasks: KodyTask[]): {
  runningCount: number
  backlogCount: number
  queueCount: number
} {
  const backlogCount = tasks.filter((t) => t.column === 'open').length
  const queueCount = tasks.filter((t) =>
    t.labels.some((l) => QUEUE_LABELS.includes(l as (typeof QUEUE_LABELS)[number])),
  ).length
  return {
    backlogCount,
    runningCount: tasks.length - backlogCount,
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
 * Uses Vercel's Protection Bypass for Automation with SameSite=None
 * to allow embedding in iframes.
 *
 * @param previewUrl - The Vercel preview deployment URL
 * @returns URL with bypass query params appended, or original URL if no secret configured
 */
export function getPreviewBypassUrl(previewUrl: string | undefined | null): string | null {
  if (!previewUrl) return null

  // Read env var at runtime to support test mocking
  const bypassSecret = process.env.NEXT_PUBLIC_VERCEL_BYPASS_SECRET

  if (!bypassSecret) {
    console.warn('[Kody] NEXT_PUBLIC_VERCEL_BYPASS_SECRET not set - iframe preview may be blocked')
    return previewUrl
  }

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
