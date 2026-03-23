/**
 * @fileType component
 * @domain kody
 * @pattern animated-status-bar
 * @ai-summary Animated progress bar that IS the status — color, fill, animation communicate state at a glance
 */
'use client'

import { useState, useEffect } from 'react'
import { cn } from '../../utils'
import type { KodyTask, ColumnId } from '../../types'
import { ALL_STAGES } from '../../constants'
import { derivePipelineDisplayState, formatElapsed, stageLabels } from '../../pipeline-utils'

// ═══════════════════════════════════════════
// STATUS BAR CONFIG — color + animation per state
// ═══════════════════════════════════════════

interface StatusBarStyle {
  /** Tailwind classes for the filled portion of the bar */
  barFill: string
  /** Tailwind classes for the bar track (background) */
  barTrack: string
  /** Tailwind classes for the glow effect underneath */
  glow: string
  /** Tailwind class for the left accent border */
  border: string
  /** Additional CSS animation class on the fill */
  animation: string
}

const statusStyles: Record<ColumnId, StatusBarStyle> = {
  building: {
    barFill: 'bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500',
    barTrack: 'bg-blue-500/10',
    glow: 'shadow-[0_0_12px_rgba(59,130,246,0.3)]',
    border: 'border-l-blue-500',
    animation: 'animate-kody-pulse',
  },
  retrying: {
    barFill: 'bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500',
    barTrack: 'bg-orange-500/10',
    glow: 'shadow-[0_0_12px_rgba(249,115,22,0.3)]',
    border: 'border-l-orange-500',
    animation: 'animate-kody-pulse',
  },
  'gate-waiting': {
    barFill: 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500',
    barTrack: 'bg-amber-500/10',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.25)]',
    border: 'border-l-amber-500',
    animation: 'animate-kody-breathe',
  },
  review: {
    barFill: 'bg-gradient-to-r from-purple-500 via-violet-400 to-purple-500',
    barTrack: 'bg-purple-500/10',
    glow: 'shadow-[0_0_8px_rgba(168,85,247,0.2)]',
    border: 'border-l-purple-500',
    animation: '',
  },
  failed: {
    barFill: 'bg-gradient-to-r from-red-500 via-red-400 to-red-500',
    barTrack: 'bg-red-500/10',
    glow: '',
    border: 'border-l-red-500',
    animation: '',
  },
  done: {
    barFill: 'bg-gradient-to-r from-emerald-500 via-green-400 to-emerald-500',
    barTrack: 'bg-emerald-500/8',
    glow: '',
    border: 'border-l-emerald-500/50',
    animation: '',
  },
  open: {
    barFill: '',
    barTrack: '',
    glow: '',
    border: 'border-l-zinc-700',
    animation: '',
  },
}

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════

interface AnimatedStatusBarProps {
  task: KodyTask
  className?: string
}

export function AnimatedStatusBar({ task, className }: AnimatedStatusBarProps) {
  const [, setTick] = useState(0)
  const isActive =
    task.column === 'building' || task.column === 'retrying' || task.column === 'gate-waiting'

  // Tick every 3s to keep elapsed time fresh
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => setTick((t) => t + 1), 3000)
    return () => clearInterval(interval)
  }, [isActive])

  const style = statusStyles[task.column]
  const totalStages = ALL_STAGES.length

  // ── No bar for backlog ──
  if (task.column === 'open') {
    return null
  }

  // ── Done: simple full green bar ──
  if (task.column === 'done') {
    return (
      <div className={cn('relative', className)}>
        <div className={cn('h-1.5 rounded-full overflow-hidden', style.barTrack)}>
          <div
            className={cn(
              'h-full rounded-full transition-all duration-1000 ease-out',
              style.barFill,
            )}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    )
  }

  // ── Failed: partial bar with X marker ──
  if (task.column === 'failed') {
    const failedPercent = getFailedPercent(task)
    return (
      <div className={cn('relative', className)}>
        <div className={cn('h-1.5 rounded-full overflow-hidden', style.barTrack)}>
          <div className="h-full flex items-center" style={{ width: `${failedPercent}%` }}>
            <div className={cn('h-full rounded-l-full flex-1', style.barFill)} />
            {/* Failure X marker at end of bar */}
            <div className="h-full w-1.5 bg-red-400 rounded-r-full" />
          </div>
        </div>
        <BarLabel task={task} style={style} />
      </div>
    )
  }

  // ── Review: full purple bar ──
  if (task.column === 'review') {
    return (
      <div className={cn('relative', className)}>
        <div className={cn('h-1.5 rounded-full overflow-hidden', style.barTrack)}>
          <div className={cn('h-full rounded-full', style.barFill)} style={{ width: '100%' }} />
        </div>
        <BarLabel task={task} style={style} />
      </div>
    )
  }

  // ── Active states: building, retrying, gate-waiting ──
  const displayState = derivePipelineDisplayState(task)
  const percent = getActivePercent(displayState, totalStages)

  return (
    <div className={cn('relative', className)}>
      {/* Bar track */}
      <div className={cn('h-1.5 rounded-full overflow-hidden relative', style.barTrack)}>
        {/* Filled portion */}
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700 ease-out relative',
            style.barFill,
            style.glow,
            style.animation,
          )}
          style={{ width: `${Math.max(percent, 3)}%` }}
        >
          {/* Leading edge glow for active tasks */}
          {(task.column === 'building' || task.column === 'retrying') && (
            <div className="absolute right-0 top-0 h-full w-3 bg-gradient-to-l from-white/40 to-transparent rounded-r-full animate-kody-leading-edge" />
          )}
        </div>

        {/* Shimmer overlay for building state */}
        {task.column === 'building' && (
          <div className="absolute inset-0 overflow-hidden rounded-full">
            <div className="h-full w-1/4 bg-gradient-to-r from-transparent via-white/15 to-transparent animate-kody-shimmer" />
          </div>
        )}

        {/* Breathing pause markers for gate-waiting */}
        {task.column === 'gate-waiting' && (
          <div className="absolute inset-0 overflow-hidden rounded-full">
            <div
              className="h-full bg-gradient-to-r from-transparent via-amber-300/20 to-transparent animate-kody-breathe-overlay"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      {/* Label below bar */}
      <BarLabel task={task} style={style} />
    </div>
  )
}

// ═══════════════════════════════════════════
// BAR LABEL — text below the bar
// ═══════════════════════════════════════════

function BarLabel({ task, style: _style }: { task: KodyTask; style: StatusBarStyle }) {
  const displayState = derivePipelineDisplayState(task)
  const totalStages = ALL_STAGES.length

  const labelText = (() => {
    if (task.column === 'review') {
      return task.associatedPR ? `PR #${task.associatedPR.number} ready` : 'Ready for review'
    }

    if (task.column === 'failed') {
      const failedStage = task.pipeline?.currentStage
      const label = failedStage ? stageLabels[failedStage] || failedStage : 'build'
      return `failed at ${label}`
    }

    switch (displayState.kind) {
      case 'stage-progress':
        return `${displayState.label} · ${displayState.stepNumber}/${totalStages}`
      case 'gate-paused': {
        const gateLabel =
          task.gateType === 'hard-stop'
            ? 'hard-stop'
            : task.gateType === 'risk-gated'
              ? 'risk-gated'
              : 'needs approval'
        return `${gateLabel} · ${displayState.label}`
      }
      case 'starting':
        return 'starting...'
      case 'no-data':
        return displayState.workflowStatus === 'queued' ? 'queued...' : 'starting...'
    }
  })()

  const elapsed = task.pipeline?.startedAt ? formatElapsed(new Date(task.pipeline.startedAt)) : null

  // Color text to match the bar
  const textColorMap: Partial<Record<ColumnId, string>> = {
    building: 'text-blue-400/80',
    retrying: 'text-orange-400/80',
    'gate-waiting': 'text-amber-400/80',
    review: 'text-purple-400/80',
    failed: 'text-red-400/80',
  }

  return (
    <div className="flex items-center justify-between mt-1">
      <span className={cn('text-[11px] font-medium', textColorMap[task.column] || 'text-zinc-500')}>
        {labelText}
      </span>
      {elapsed && (
        <span className="text-[10px] text-zinc-500 font-mono tabular-nums">{elapsed}</span>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function getActivePercent(
  displayState: ReturnType<typeof derivePipelineDisplayState>,
  totalStages: number,
): number {
  switch (displayState.kind) {
    case 'stage-progress':
      // Each stage is a segment. Current stage gets partial fill.
      return Math.round(((displayState.stageIndex + 0.5) / totalStages) * 100)
    case 'gate-paused':
      return displayState.stageIndex >= 0
        ? Math.round(((displayState.stageIndex + 0.5) / totalStages) * 100)
        : 15
    case 'starting':
      return 5
    case 'no-data':
      return 3
  }
}

function getFailedPercent(task: KodyTask): number {
  const pipeline = task.pipeline
  if (!pipeline) return 30
  const completedCount = Object.values(pipeline.stages || {}).filter(
    (s) => s.state === 'completed',
  ).length
  return Math.max(10, Math.round((completedCount / ALL_STAGES.length) * 100))
}
