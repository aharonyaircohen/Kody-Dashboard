/**
 * @fileType component
 * @domain kody
 * @pattern tooltip-content
 * @ai-summary Pre-built tooltip content blocks for common dashboard elements
 */
import React from 'react'
import type { ColumnId } from '../types'

const statusExplanations: Record<
  ColumnId,
  { title: string; description: string; action?: string }
> = {
  open: {
    title: 'Backlog',
    description: 'Task is waiting to be picked up. No pipeline has started yet.',
    action: 'Click the Play button to start the pipeline.',
  },
  building: {
    title: 'Building',
    description: 'Kody is actively working on this task. The pipeline is running.',
  },
  review: {
    title: 'In Review',
    description: 'Code changes are ready. A PR has been created and CI checks are running.',
    action: 'Review the PR and merge when CI passes.',
  },
  failed: {
    title: 'Failed',
    description: 'The pipeline encountered an error and could not complete.',
    action: 'Check the error details and retry or fix manually.',
  },
  'gate-waiting': {
    title: 'Needs Approval',
    description: 'Pipeline paused — your approval is needed before Kody continues.',
    action: 'Review the changes and approve to continue.',
  },
  retrying: {
    title: 'Retrying',
    description: 'A previous attempt failed. Kody is retrying the pipeline.',
  },
  done: {
    title: 'Done',
    description: 'Task is complete. Changes have been merged.',
  },
}

export function StatusTooltipContent({
  column,
  gateType,
}: {
  column: ColumnId
  gateType?: string
}) {
  const info = statusExplanations[column]
  if (!info) return null

  return (
    <div className="space-y-1">
      <p className="font-semibold text-xs">{info.title}</p>
      <p className="text-xs text-muted-foreground">{info.description}</p>
      {column === 'gate-waiting' && gateType && (
        <p className="text-xs text-yellow-400">
          Gate type:{' '}
          {gateType === 'hard-stop'
            ? 'Hard Stop (manual approval required)'
            : 'Risk Gated (auto-continues if low risk)'}
        </p>
      )}
      {info.action && <p className="text-xs text-blue-400 mt-0.5">→ {info.action}</p>}
    </div>
  )
}

export function CIStatusTooltipContent({
  ciStatus,
}: {
  ciStatus: 'pending' | 'success' | 'failure' | 'running'
}) {
  const info: Record<string, { description: string; detail?: string }> = {
    pending: {
      description: 'CI checks have not started yet.',
      detail: 'Waiting for GitHub Actions to pick up the job.',
    },
    running: {
      description: 'CI checks are in progress.',
      detail: 'Merge will be available when all checks pass.',
    },
    success: {
      description: 'All CI checks passed.',
      detail: 'Ready to merge!',
    },
    failure: {
      description: 'One or more CI checks failed.',
      detail: 'Check the PR on GitHub for details.',
    },
  }

  const status = info[ciStatus]
  if (!status) return null

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold">
        {ciStatus === 'pending' && '⏳ CI Pending'}
        {ciStatus === 'running' && '🔄 CI Running'}
        {ciStatus === 'success' && '✅ CI Passed'}
        {ciStatus === 'failure' && '❌ CI Failed'}
      </p>
      <p className="text-xs text-muted-foreground">{status.description}</p>
      {status.detail && <p className="text-xs text-muted-foreground/70">{status.detail}</p>}
    </div>
  )
}

export function SubStatusTooltipContent({
  type,
}: {
  type: 'timeout' | 'exhausted' | 'error' | 'needs-answer'
}) {
  const info: Record<string, { title: string; description: string; action: string }> = {
    timeout: {
      title: '⏰ Pipeline Timeout',
      description: 'The pipeline exceeded its maximum allowed execution time.',
      action: 'Try rerunning or break the task into smaller pieces.',
    },
    exhausted: {
      title: '🔄 Retries Exhausted',
      description: 'The pipeline failed and all automatic retry attempts have been used.',
      action: 'Review the errors and consider manual intervention.',
    },
    error: {
      title: '⚠️ Supervisor Error',
      description: 'An infrastructure error occurred in the pipeline supervisor.',
      action: 'This is usually transient — try rerunning the task.',
    },
    'needs-answer': {
      title: '❓ Needs Clarification',
      description: 'Kody has a question and is waiting for your answer before continuing.',
      action: 'Open the task and reply to the clarification question.',
    },
  }

  const status = info[type]
  if (!status) return null

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold">{status.title}</p>
      <p className="text-xs text-muted-foreground">{status.description}</p>
      <p className="text-xs text-blue-400">→ {status.action}</p>
    </div>
  )
}

export function MergeTooltipContent({
  canMerge,
  ciStatus,
  isMerging,
  hasConflicts = false,
  isApproved = false,
}: {
  canMerge: boolean
  ciStatus: 'pending' | 'success' | 'failure' | 'running'
  isMerging: boolean
  hasConflicts?: boolean
  isApproved?: boolean
}) {
  if (isMerging) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold">🔄 Merging…</p>
        <p className="text-xs text-muted-foreground">Squash merge in progress. Please wait.</p>
      </div>
    )
  }

  // Check if approvals are missing
  if (!isApproved) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold">⏳ Approval Required</p>
        <p className="text-xs text-muted-foreground">
          Approve UI and PR before merging. Click on the task to approve.
        </p>
      </div>
    )
  }

  if (canMerge) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold">✅ Ready to Merge</p>
        <p className="text-xs text-muted-foreground">
          All CI checks passed. Click to open merge dialog.
        </p>
      </div>
    )
  }

  if (hasConflicts) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold">⚠️ Merge Conflicts</p>
        <p className="text-xs text-muted-foreground">
          This PR has merge conflicts that must be resolved before merging.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Update the branch or resolve conflicts on GitHub.
        </p>
      </div>
    )
  }

  return <CIStatusTooltipContent ciStatus={ciStatus} />
}
