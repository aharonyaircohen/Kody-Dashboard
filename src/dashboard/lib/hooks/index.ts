/**
 * @fileType hooks
 * @domain kody
 * @pattern custom-hooks
 * @ai-summary React Query hooks for Kody dashboard data fetching
 */
'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { kodyApi, RateLimitError, NoTokenError, SessionExpiredError } from '../api'
import type { KodyTask } from '../types'
import type { ViewMode } from '../components/FilterBar'
import { POLLING_INTERVALS } from '../constants'

// Re-export new hooks
export { useDashboardFilters } from './useDashboardFilters'
export { useDashboardRouter } from './useDashboardRouter'

// Query keys
export const queryKeys = {
  tasks: (days?: number, includeDetails?: boolean) => ['kody-tasks', days, includeDetails] as const,
  taskDetails: (issueNumber: number) => ['kody-task', issueNumber] as const,
  boards: ['kody-boards'] as const,
  collaborators: ['kody-collaborators'] as const,
  workflowRuns: ['kody-workflow-runs'] as const,
}

// ============ useKodyTasks ============

export interface UseKodyTasksOptions {
  days?: number
  includeDetails?: boolean
  /**
   * Current view mode — 'running' or 'backlog'.
   * When 'backlog', polling slows to 120s since backlog tasks change rarely.
   */
  viewMode?: ViewMode
  /**
   * Auto-refresh interval based on task state.
   * - 'auto': Uses smart polling based on running tasks and view mode
   * - 'idle': 60s interval when no tasks are running
   * - 'board': 30s interval when tasks are on board
   * - 'active': 15s interval when viewing active task
   * - false: Disable auto-refresh
   */
  refetchInterval?: 'auto' | 'idle' | 'board' | 'active' | false
}

/**
 * Determine polling interval based on current task data and view mode.
 * - Backlog view: poll every 120s (tasks change rarely)
 * - Running view with active tasks (building/retrying/gate-waiting): poll every 30s
 * - Running view, all idle: poll every 60s
 */
export function getSmartInterval(
  tasks: KodyTask[] | undefined,
  viewMode: ViewMode = 'running',
): number {
  if (!tasks || tasks.length === 0) return POLLING_INTERVALS.idle

  // Backlog view — slow polling since these tasks change rarely
  if (viewMode === 'backlog') return POLLING_INTERVALS.backlog

  const hasActive = tasks.some(
    (t) => t.column === 'building' || t.column === 'retrying' || t.column === 'gate-waiting',
  )

  return hasActive ? POLLING_INTERVALS.board : POLLING_INTERVALS.idle
}

export function useKodyTasks(options: UseKodyTasksOptions = {}) {
  const { days, includeDetails = false, viewMode = 'running', refetchInterval = 'auto' } = options

  return useQuery({
    queryKey: queryKeys.tasks(days, includeDetails),
    queryFn: () => kodyApi.tasks.list({ days, includeDetails }),
    refetchInterval: (query): number | false => {
      if (refetchInterval === false) return false

      // Stop polling when session expired or no token — user must re-authenticate
      if (query.state.error instanceof SessionExpiredError) return false
      if (query.state.error instanceof NoTokenError) return false

      // Smart auto mode: inspect data to decide interval
      if (refetchInterval === 'auto') {
        return getSmartInterval(query.state.data, viewMode)
      }

      return POLLING_INTERVALS[refetchInterval]
    },
    refetchIntervalInBackground: false, // Don't poll when tab is hidden
    refetchOnWindowFocus: 'always', // Refresh when user tabs back (even if not stale)
    staleTime: 30_000, // 30s — prevents rapid re-fetches from invalidations; polling handles freshness
    retry: (failureCount, error) => {
      if (error instanceof RateLimitError) return false
      if (error instanceof NoTokenError) return false
      if (error instanceof SessionExpiredError) return false
      return failureCount < 3
    },
  })
}

// ============ useKodyBoards ============

export function useKodyBoards() {
  return useQuery({
    queryKey: queryKeys.boards,
    queryFn: () => kodyApi.boards.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============ useCollaborators ============

export function useCollaborators() {
  return useQuery({
    queryKey: queryKeys.collaborators,
    queryFn: () => kodyApi.collaborators.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============ useTaskDetails ============

export function useTaskDetails(issueNumber: number | null, actorLogin?: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.taskDetails(issueNumber ?? -1),
    queryFn: () => kodyApi.tasks.get(issueNumber!),
    enabled: !!issueNumber,
    staleTime: 60_000, // 60s — assignee updates are reflected via list polling; detail is fetched on select
  })

  // Mutations for task actions — only invalidate the detail query, not the task list.
  // The task list refreshes via polling; double-invalidation wastes API quota.
  const executeMutation = useMutation({
    mutationFn: () => kodyApi.tasks.execute(issueNumber!, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskDetails(issueNumber!) })
    },
  })

  const closeMutation = useMutation({
    mutationFn: () => kodyApi.tasks.close(issueNumber!, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskDetails(issueNumber!) })
    },
  })

  const reopenMutation = useMutation({
    mutationFn: () => kodyApi.tasks.reopen(issueNumber!, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskDetails(issueNumber!) })
    },
  })

  const abortMutation = useMutation({
    mutationFn: () => kodyApi.tasks.abort(issueNumber!, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskDetails(issueNumber!) })
    },
  })

  return {
    ...query,
    execute: executeMutation.mutate,
    close: closeMutation.mutate,
    reopen: reopenMutation.mutate,
    abort: abortMutation.mutate,
    isExecuting: executeMutation.isPending,
    isClosing: closeMutation.isPending,
    isReopening: reopenMutation.isPending,
    isAborting: abortMutation.isPending,
  }
}

// ============ useWorkflowRuns ============

/**
 * Fetches all workflow runs and optionally filters them by task title.
 * The /api/kody/workflows endpoint returns up to 20 runs (no per-task filter server-side),
 * so we filter client-side by matching display_title against the provided taskTitle.
 */
export function useWorkflowRuns(taskTitle?: string) {
  return useQuery({
    queryKey: queryKeys.workflowRuns,
    queryFn: () => kodyApi.workflows.list(),
    select: (runs) => {
      if (!taskTitle) return runs
      return runs.filter((run) => run.display_title === taskTitle)
    },
    staleTime: 30_000,
    enabled: !!taskTitle,
  })
}

// ============ useCreateTask ============

export function useCreateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      title: string
      body: string
      mode: string
      labels?: string[]
      assignees?: string[]
      attachments?: Array<{ name: string; content: string }>
      actorLogin?: string
    }) => kodyApi.tasks.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kody-tasks'] })
    },
  })
}

// ============ useUpdateTask ============

export function useUpdateTask(issueNumber: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      title?: string
      body?: string
      labels?: string[]
      assignees?: string[]
      actorLogin?: string
    }) => kodyApi.tasks.update(issueNumber, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kody-tasks'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.taskDetails(issueNumber) })
    },
  })
}

// ============ usePostComment ============

export function usePostComment(issueNumber: number, actorLogin?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (comment: string) => kodyApi.tasks.comment(issueNumber, comment, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.taskDetails(issueNumber) })
    },
  })
}

// ============ useRetryWithContext ============

export interface UseRetryWithContextOptions {
  issueNumber: number
  actorLogin?: string
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export function useRetryWithContext({
  issueNumber,
  actorLogin,
  onSuccess,
  onError,
}: UseRetryWithContextOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (context: string) => {
      // First post the comment with @kody retry and context
      await kodyApi.tasks.retryWithContext(issueNumber, context, actorLogin)
      // Then trigger execution
      await kodyApi.tasks.execute(issueNumber, actorLogin)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kody-tasks'] })
      onSuccess?.()
    },
    onError,
  })
}

// ============ useTaskActions ============

export interface UseTaskActionsOptions {
  issueNumber: number
  actorLogin?: string
  onSuccess?: () => void
  onError?: (error: Error) => void
}

/**
 * Hook providing all task action mutations with per-action pending states
 * and toast notifications for user feedback.
 */
export function useTaskActions({
  issueNumber,
  actorLogin,
  onSuccess,
  onError,
}: UseTaskActionsOptions) {
  const queryClient = useQueryClient()

  const handleError = (label: string) => (error: Error) => {
    toast.error(`Failed to ${label}`, { description: error.message })
    onError?.(error)
  }

  const handleSuccess = (label: string) => () => {
    // Only invalidate the specific task detail — task list refreshes via polling.
    // This prevents mutations from triggering 3+ GitHub API calls per action.
    queryClient.invalidateQueries({ queryKey: queryKeys.taskDetails(issueNumber) })
    toast.success(label)
    onSuccess?.()
  }

  const execute = useMutation({
    mutationFn: () => kodyApi.tasks.execute(issueNumber, actorLogin),
    onSuccess: handleSuccess('Task started'),
    onError: handleError('start task'),
  })

  const rerun = useMutation({
    mutationFn: () => kodyApi.tasks.rerun(issueNumber, actorLogin),
    onSuccess: handleSuccess('Task rerun'),
    onError: handleError('rerun task'),
  })

  const close = useMutation({
    mutationFn: () => kodyApi.tasks.close(issueNumber, actorLogin),
    onSuccess: handleSuccess('Issue closed'),
    onError: handleError('close issue'),
  })

  const reopen = useMutation({
    mutationFn: () => kodyApi.tasks.reopen(issueNumber, actorLogin),
    onSuccess: handleSuccess('Issue reopened'),
    onError: handleError('reopen issue'),
  })

  const abort = useMutation({
    mutationFn: () => kodyApi.tasks.abort(issueNumber, actorLogin),
    onSuccess: handleSuccess('Task stopped'),
    onError: handleError('stop task'),
  })

  const closePR = useMutation({
    mutationFn: () => kodyApi.tasks.closePR(issueNumber, actorLogin),
    onSuccess: handleSuccess('PR closed'),
    onError: handleError('close PR'),
  })

  const reset = useMutation({
    mutationFn: () => kodyApi.tasks.reset(issueNumber, actorLogin),
    onSuccess: handleSuccess('Task reset successfully'),
    onError: handleError('reset task'),
  })

  const approveGate = useMutation({
    mutationFn: () => kodyApi.tasks.approveGate(issueNumber, actorLogin),
    onSuccess: handleSuccess('Gate approved'),
    onError: handleError('approve gate'),
  })

  const rejectGate = useMutation({
    mutationFn: () => kodyApi.tasks.rejectGate(issueNumber, actorLogin),
    onSuccess: handleSuccess('Gate rejected'),
    onError: handleError('reject gate'),
  })

  const approveUI = useMutation({
    mutationFn: () => kodyApi.tasks.approveUI(issueNumber, actorLogin),
    onSuccess: handleSuccess('Preview UI approved'),
    onError: handleError('approve UI'),
  })

  const approvePR = useMutation({
    mutationFn: () => kodyApi.tasks.approvePR(issueNumber, actorLogin),
    onSuccess: handleSuccess('PR approved'),
    onError: handleError('approve PR'),
  })

  const assign = useMutation({
    mutationFn: (assignees: string[]) => kodyApi.tasks.assign(issueNumber, assignees, actorLogin),
    onSuccess: handleSuccess('User(s) assigned'),
    onError: handleError('assign user'),
  })

  const unassign = useMutation({
    mutationFn: (assignees: string[]) => kodyApi.tasks.unassign(issueNumber, assignees, actorLogin),
    onSuccess: handleSuccess('User(s) unassigned'),
    onError: handleError('unassign user'),
  })

  const addToQueue = useMutation({
    mutationFn: () => kodyApi.tasks.addToQueue(issueNumber, actorLogin),
    onSuccess: handleSuccess('Added to queue'),
    onError: handleError('add to queue'),
  })

  const removeFromQueue = useMutation({
    mutationFn: () => kodyApi.tasks.removeFromQueue(issueNumber, actorLogin),
    onSuccess: handleSuccess('Removed from queue'),
    onError: handleError('remove from queue'),
  })

  const isPending =
    execute.isPending ||
    close.isPending ||
    closePR.isPending ||
    reset.isPending ||
    reopen.isPending ||
    abort.isPending ||
    approveGate.isPending ||
    rejectGate.isPending ||
    approveUI.isPending ||
    approvePR.isPending ||
    assign.isPending ||
    unassign.isPending ||
    addToQueue.isPending ||
    removeFromQueue.isPending

  return {
    execute: execute.mutate,
    rerun: rerun.mutate,
    close: close.mutate,
    closePR: closePR.mutate,
    reset: reset.mutate,
    reopen: reopen.mutate,
    abort: abort.mutate,
    approveGate: approveGate.mutate,
    rejectGate: rejectGate.mutate,
    approveUI: approveUI.mutate,
    approvePR: approvePR.mutate,
    assign: assign.mutate,
    unassign: unassign.mutate,
    addToQueue: addToQueue.mutate,
    removeFromQueue: removeFromQueue.mutate,
    isPending,
    pendingAction: execute.isPending
      ? 'execute'
      : abort.isPending
        ? 'abort'
        : approveGate.isPending
          ? 'approve'
          : rejectGate.isPending
            ? 'reject'
            : approveUI.isPending
              ? 'approve-ui'
              : approvePR.isPending
                ? 'approve-pr'
                : close.isPending
                  ? 'close'
                  : closePR.isPending
                    ? 'close-pr'
                    : reset.isPending
                      ? 'reset'
                      : reopen.isPending
                        ? 'reopen'
                        : addToQueue.isPending
                          ? 'add-to-queue'
                          : removeFromQueue.isPending
                            ? 'remove-from-queue'
                            : null,
  }
}
