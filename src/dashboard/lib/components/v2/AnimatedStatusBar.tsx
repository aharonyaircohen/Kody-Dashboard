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
import {
  derivePipelineDisplayState,
  formatElapsed,
  getReviewPercent,
  getStageBoundaries,
  getWeightedActiveProgress,
  stageLabels,
} from '../../pipeline-utils'

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

  // Tick every 1s so the live-elapsed asymptotic fill advances visibly.
  // Cheap because re-render is local to this component; CSS transition smooths.
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
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

  // ── Review: gradual purple bar based on PR signals ──
  // 65 (CI failed) → 70 (kody mid-flow stale) → 75 (conflicts) →
  // 82 (CI running) → 88 (unknown) → 96 (CI green, awaiting merge).
  // Only `done` reaches 100%, so the eye can distinguish "ready" vs "merged".
  if (task.column === 'review') {
    const reviewPercent = getReviewPercent(task)
    return (
      <div className={cn('relative', className)}>
        <div className={cn('h-1.5 rounded-full overflow-hidden', style.barTrack)}>
          <div
            className={cn('h-full rounded-full transition-all duration-700 ease-out', style.barFill)}
            style={{ width: `${reviewPercent}%` }}
          />
        </div>
        <BarLabel task={task} style={style} />
      </div>
    )
  }

  // ── Active states: building, retrying, gate-waiting ──
  const displayState = derivePipelineDisplayState(task)
  const percent = getActivePercent(displayState, task, totalStages)
  const boundaries = getStageBoundaries(task)

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

        {/* Stage tick markers — vertical lines at each stage boundary so
            users can see discrete steps inside the smooth fill. */}
        {boundaries.length > 1 &&
          boundaries.slice(0, -1).map((b) => (
            <div
              key={b.stage}
              className={cn(
                'absolute top-0 h-full w-px pointer-events-none',
                b.isCompleted ? 'bg-white/40' : 'bg-zinc-500/40',
              )}
              style={{ left: `${b.position * 100}%` }}
              title={stageLabels[b.stage] || b.stage}
            />
          ))}

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
  // Use the engine's actual stages (any name, in execution order) so step N/M
  // reflects what the engine is really running — not just stages whose names
  // happen to be in the dashboard's ALL_STAGES vocabulary.
  const trackedStages = task.pipeline?.stages ? Object.keys(task.pipeline.stages) : []
  const trackedCount = trackedStages.length
  const totalStages = trackedCount > 0 ? trackedCount : ALL_STAGES.length

  // Re-derive step number against tracked stages when we have them.
  const trackedStepNumber = (() => {
    if (displayState.kind !== 'stage-progress' || trackedCount === 0) return null
    const idx = trackedStages.findIndex((s) => s === task.pipeline?.currentStage)
    return idx >= 0 ? idx + 1 : null
  })()

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
      case 'stage-progress': {
        const step = trackedStepNumber ?? displayState.stepNumber
        return `${displayState.label} · ${step}/${totalStages}`
      }
      case 'gate-paused': {
        const gateLabel =
          task.gateType === 'hard-stop'
            ? 'hard-stop'
            : task.gateType === 'risk-gated'
              ? 'risk-gated'
              : 'needs approval'
        return `${gateLabel} · ${displayState.label}`
      }
      case 'starting': {
        // After ~2 min without engine data, "starting..." is misleading —
        // the workflow is running but the dashboard hasn't fetched the
        // pipeline JSON yet (or the engine hasn't written it).
        const startStr =
          task.pipeline?.startedAt ?? task.workflowRun?.created_at ?? task.updatedAt
        if (startStr && Date.now() - new Date(startStr).getTime() > 2 * 60 * 1000) {
          return 'running...'
        }
        return 'starting...'
      }
      case 'no-data': {
        if (displayState.workflowStatus === 'queued') return 'queued...'
        const startStr = task.workflowRun?.created_at ?? task.updatedAt
        if (startStr && Date.now() - new Date(startStr).getTime() > 2 * 60 * 1000) {
          return 'running...'
        }
        return 'starting...'
      }
    }
  })()

  // Use the most recent start signal so re-runs (sync/fix-ci) reset the timer
  // instead of showing days-old elapsed time from the original run.
  const elapsed = (() => {
    const candidates = [
      task.pipeline?.startedAt,
      task.workflowRun?.created_at,
      task.updatedAt,
    ].filter((s): s is string => Boolean(s))
    if (candidates.length === 0) return null
    const latestMs = Math.max(...candidates.map((s) => new Date(s).getTime()))
    return formatElapsed(new Date(latestMs))
  })()

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

/**
 * Time-based asymptotic floor (0-95) using whatever start timestamp we have.
 * Pipeline JSON load can lag the task list (separate fetch, cached separately,
 * or skipped for not-yet-active tasks), so we fall back to workflowRun start
 * or task.updatedAt so the bar still advances visibly during that window.
 */
function getTimeFloor(task: KodyTask): number {
  // Prefer the most recent start signal. For `@kody sync` / `@kody fix-ci`
  // re-runs on done/failed tasks, the cached pipeline.startedAt points at the
  // ORIGINAL run (potentially days ago) and would peg the floor at 95%.
  // workflowRun.created_at reflects the new run; pick whichever is later.
  const candidates = [
    task.pipeline?.startedAt,
    task.workflowRun?.created_at,
    task.updatedAt,
  ].filter((s): s is string => Boolean(s))
  if (candidates.length === 0) return 0
  const latestMs = Math.max(...candidates.map((s) => new Date(s).getTime()))
  const elapsedMs = Math.max(0, Date.now() - latestMs)
  if (elapsedMs <= 0) return 0
  const median = 30 * 60 * 1000
  return Math.min(95, (1 - Math.exp(-elapsedMs / median)) * 100)
}

function getActivePercent(
  displayState: ReturnType<typeof derivePipelineDisplayState>,
  task: KodyTask,
  totalStages: number,
): number {
  const floor = getTimeFloor(task)
  switch (displayState.kind) {
    case 'stage-progress': {
      // Prefer duration-weighted progress with within-stage elapsed fill.
      // Fall back to equal-segment estimate when stages map is empty.
      const weighted = getWeightedActiveProgress(task)
      if (weighted > 0) return Math.round(Math.max(weighted, floor))
      return Math.round(
        Math.max(((displayState.stageIndex + 0.5) / totalStages) * 100, floor),
      )
    }
    case 'gate-paused': {
      const weighted = getWeightedActiveProgress(task)
      if (weighted > 0) return Math.round(Math.max(weighted, floor))
      const fallback =
        displayState.stageIndex >= 0
          ? ((displayState.stageIndex + 0.5) / totalStages) * 100
          : 15
      return Math.round(Math.max(fallback, floor))
    }
    case 'starting':
      // Pipeline JSON not loaded yet — use time floor (or 5% minimum) so the
      // bar doesn't sit at the start while the engine is actually working.
      return Math.round(Math.max(5, floor))
    case 'no-data':
      return Math.round(Math.max(3, floor))
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
