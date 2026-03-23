/**
 * @fileType component
 * @domain kody
 * @pattern pipeline-progress
 * @ai-summary Compact pipeline progress indicator with two variants: "inline" (dot-separated text for metadata line) and "bar" (full progress bar for dedicated row). Both variants always render 12 dots — one per stage — for visual consistency across all tasks.
 */
'use client'

import { useState, useEffect } from 'react'
import { cn } from '../utils'
import type { KodyTask } from '../types'
import { ALL_STAGES } from '../constants'
import { derivePipelineDisplayState, getStageTooltip, formatElapsed } from '../pipeline-utils'
import { Loader2, Timer, Pause, ExternalLink } from 'lucide-react'

interface MiniPipelineProgressProps {
  task: KodyTask
  className?: string
  /** "inline" = compact text for metadata line; "bar" = full progress bar for dedicated row */
  variant?: 'inline' | 'bar'
}

/**
 * Compact pipeline progress for task list cards.
 *
 * Two variants:
 * - `inline`: Shows ●●●○○ Analyzing · 3/12 as inline text in the metadata dot-separator line
 * - `bar`: Shows a full-width progress bar with stage dots for a dedicated row below the title
 *
 * Both variants always show 12 dots (one per ALL_STAGES) when progress data is available.
 * Gate-paused tasks always show yellow pause indicator — never "Starting...".
 */
export function MiniPipelineProgress({
  task,
  className,
  variant = 'inline',
}: MiniPipelineProgressProps) {
  const [, setTick] = useState(0)
  const isActive =
    task.column === 'building' || task.column === 'retrying' || task.column === 'gate-waiting'

  // Tick every 5 seconds to keep elapsed time fresh for active tasks
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => setTick((t) => t + 1), 5000)
    return () => clearInterval(interval)
  }, [isActive])

  // Not an active task — don't show progress
  if (!isActive) return null

  const displayState = derivePipelineDisplayState(task)

  if (variant === 'bar') {
    return <BarVariant displayState={displayState} task={task} className={className} />
  }

  return <InlineVariant displayState={displayState} task={task} className={className} />
}

// ══════════════════════════════════════════════════════
// INLINE VARIANT — for the metadata dot-separator line
// ══════════════════════════════════════════════════════

function InlineVariant({
  displayState,
  task: _task,
  className,
}: {
  displayState: ReturnType<typeof derivePipelineDisplayState>
  task: KodyTask
  className?: string
}) {
  // Inline variant shows dots-only — the bar row below has the full text + elapsed.
  // This avoids showing the same status text twice per task card.
  switch (displayState.kind) {
    case 'stage-progress':
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          <StageDots currentIndex={displayState.stageIndex} state="running" size="inline" />
        </span>
      )

    case 'gate-paused':
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          <StageDots currentIndex={displayState.stageIndex} state="paused" size="inline" />
          <Pause className="w-3 h-3 text-yellow-400" />
        </span>
      )

    case 'starting':
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
        </span>
      )

    case 'no-data':
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
        </span>
      )
  }
}

// ══════════════════════════════════════════════════════
// BAR VARIANT — for the dedicated progress row
// ══════════════════════════════════════════════════════

function BarVariant({
  displayState,
  task,
  className,
}: {
  displayState: ReturnType<typeof derivePipelineDisplayState>
  task: KodyTask
  className?: string
}) {
  const workflowRun = task.workflowRun
  const pipeline = task.pipeline

  switch (displayState.kind) {
    case 'stage-progress':
      return (
        <div className={cn('flex items-center gap-2', className)}>
          <StageDots currentIndex={displayState.stageIndex} state="running" size="bar" />
          <span className="text-[11px] text-blue-400 font-medium truncate max-w-28">
            {displayState.label}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
            {displayState.stepNumber}/{displayState.totalStages}
          </span>
          <ElapsedBadge since={pipeline?.startedAt} />
          {workflowRun?.html_url && (
            <a
              href={workflowRun.html_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-zinc-500 hover:text-blue-400 transition-colors"
              title="View GitHub Actions workflow run"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      )

    case 'gate-paused':
      return (
        <div className={cn('flex items-center gap-2', className)}>
          <StageDots currentIndex={displayState.stageIndex} state="paused" size="bar" />
          <Pause className="w-3 h-3 text-yellow-400" />
          <span className="text-[11px] text-yellow-400 font-medium">
            Paused · {displayState.label}
          </span>
          <ElapsedBadge since={pipeline?.startedAt} />
        </div>
      )

    case 'starting':
      return (
        <div className={cn('flex items-center gap-2', className)}>
          <div className="w-20 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-blue-500/0 via-blue-400 to-blue-500/0 rounded-full animate-shimmer" />
          </div>
          <span className="text-[11px] text-blue-400/80">Starting...</span>
          <ElapsedBadge since={pipeline?.startedAt} />
        </div>
      )

    case 'no-data': {
      const startTime = workflowRun?.created_at || task.updatedAt
      const wfStatus = workflowRun?.status
      return (
        <div className={cn('flex items-center gap-2', className)}>
          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
          <span className="text-[11px] text-blue-400/80">
            {wfStatus === 'in_progress'
              ? 'Pipeline running...'
              : wfStatus === 'queued'
                ? 'Queued...'
                : wfStatus === 'completed'
                  ? 'Finishing up...'
                  : 'Starting...'}
          </span>
          {workflowRun?.html_url && (
            <a
              href={workflowRun.html_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-zinc-500 hover:text-blue-400 transition-colors"
              title="View GitHub Actions workflow run"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          <ElapsedBadge since={startTime} />
        </div>
      )
    }
  }
}

// ══════════════════════════════════════════════════════
// SHARED SUBCOMPONENTS
// ══════════════════════════════════════════════════════

/**
 * Consistent 12-dot progress indicator — always one dot per ALL_STAGES stage.
 * size="bar" uses slightly larger dots; size="inline" uses smaller dots.
 * Both variants use the same dot count for visual consistency across the list.
 */
function StageDots({
  currentIndex,
  state,
  size = 'bar',
}: {
  currentIndex: number
  state: 'running' | 'paused'
  size?: 'bar' | 'inline'
}) {
  const dotSize = size === 'bar' ? 'w-1.5 h-1.5' : 'w-1 h-1'
  const activeDotSize = size === 'bar' ? 'w-2 h-2' : 'w-1.5 h-1.5'
  const gap = size === 'bar' ? 'gap-[3px]' : 'gap-[2px]'

  return (
    <div className={cn('flex items-center', gap)}>
      {ALL_STAGES.map((stage, i) => {
        const isCompleted = i < currentIndex
        const isCurrent = i === currentIndex
        const isPending = i > currentIndex

        return (
          <div
            key={stage}
            className={cn(
              'rounded-full transition-all duration-300',
              isCurrent ? activeDotSize : dotSize,
              isCompleted && 'bg-blue-500',
              isCurrent &&
                state === 'running' &&
                'bg-blue-400 animate-pulse shadow-[0_0_4px_rgba(96,165,250,0.6)]',
              isCurrent &&
                state === 'paused' &&
                'bg-yellow-400 shadow-[0_0_4px_rgba(250,204,21,0.5)]',
              isPending && 'bg-zinc-600/60',
            )}
            title={getStageTooltip(stage)}
          />
        )
      })}
    </div>
  )
}

/** Elapsed time badge with timer icon */
function ElapsedBadge({ since }: { since?: string | null }) {
  if (!since) return null
  return (
    <span className="text-[10px] text-zinc-500 font-mono tabular-nums flex items-center gap-0.5">
      <Timer className="w-2.5 h-2.5" />
      {formatElapsed(new Date(since))}
    </span>
  )
}
