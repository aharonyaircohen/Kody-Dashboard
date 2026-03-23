/**
 * @fileType utility
 * @domain kody
 * @pattern pipeline-progress
 * @ai-summary Shared pipeline progress utilities — stage labels, progress calculation, elapsed formatting, tooltips
 */

import { ALL_STAGES } from './constants'
import type { KodyPipelineStatus, KodyTask, StageStatus } from './types'

/**
 * Human-readable labels for each pipeline stage
 */
export const stageLabels: Record<string, string> = {
  taskify: 'Classifying',
  gap: 'Checking Gaps',
  clarify: 'Clarifying',
  architect: 'Planning',
  'plan-gap': 'Reviewing Plan',
  build: 'Building',
  commit: 'Committing',
  review: 'Reviewing',
  fix: 'Fixing',
  verify: 'Verifying',
  pr: 'Creating PR',
  autofix: 'Auto-fixing',
}

/**
 * Typical max durations per stage (in ms) for estimating progress percentage
 */
export const stageMaxDurations: Record<string, number> = {
  taskify: 10 * 60 * 1000,
  clarify: 10 * 60 * 1000,
  architect: 30 * 60 * 1000,
  'plan-gap': 15 * 60 * 1000,
  build: 45 * 60 * 1000,
  commit: 5 * 60 * 1000,
  review: 15 * 60 * 1000,
  fix: 20 * 60 * 1000,
  verify: 15 * 60 * 1000,
  pr: 5 * 60 * 1000,
  autofix: 15 * 60 * 1000,
}

const DEFAULT_MAX_MS = 20 * 60 * 1000

export interface PipelineProgress {
  /** Index of the current stage in ALL_STAGES (0-based). -1 if unknown */
  currentStageIndex: number
  /** Total number of stages */
  totalStages: number
  /** Human-readable label for the current stage */
  currentStageLabel: string
  /** Step number (1-based) */
  stepNumber: number
  /** Estimated percentage within the current stage (0-99) */
  stagePercent: number
  /** Estimated overall percentage (0-99) */
  overallPercent: number
  /** Number of completed stages */
  completedStages: number
  /** Pipeline state */
  state: KodyPipelineStatus['state']
}

/**
 * Calculate pipeline progress from a KodyPipelineStatus object
 */
export function calculatePipelineProgress(pipeline: KodyPipelineStatus): PipelineProgress {
  const totalStages = ALL_STAGES.length
  const currentStage = pipeline.currentStage
  const currentStageIndex = currentStage
    ? ALL_STAGES.indexOf(currentStage as (typeof ALL_STAGES)[number])
    : -1

  const completedStages = Object.values(pipeline.stages || {}).filter(
    (s) => s.state === 'completed',
  ).length

  // Stage percent from elapsed time
  let stagePercent = 0
  if (currentStage && pipeline.stages?.[currentStage]?.elapsed) {
    const elapsed = pipeline.stages[currentStage].elapsed! * 1000
    const maxMs = stageMaxDurations[currentStage] || DEFAULT_MAX_MS
    stagePercent = Math.min(99, Math.round((elapsed / maxMs) * 100))
  }

  // Overall percent: completed stages + fractional current stage
  const overallPercent =
    totalStages > 0
      ? Math.min(99, Math.round(((completedStages + stagePercent / 100) / totalStages) * 100))
      : 0

  return {
    currentStageIndex,
    totalStages,
    currentStageLabel: currentStage ? stageLabels[currentStage] || currentStage : 'Starting...',
    stepNumber: currentStageIndex >= 0 ? currentStageIndex + 1 : completedStages + 1,
    stagePercent,
    overallPercent,
    completedStages,
    state: pipeline.state,
  }
}

/**
 * Format elapsed time since a date, updating live
 */
export function formatElapsed(since: Date): string {
  const ms = Date.now() - since.getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/**
 * Generate a rich tooltip title for a pipeline stage
 * Includes stage label, state, elapsed time, and error if present
 */
export function getStageTooltip(stage: string, stageData?: StageStatus): string {
  const label = stageLabels[stage] || stage
  const state = stageData?.state || 'pending'
  const elapsed = stageData?.elapsed
  const error = stageData?.error

  let tooltip = `${label} (${state})`
  if (elapsed) {
    tooltip += ` - ${formatElapsed(new Date(Date.now() - elapsed * 1000))}`
  }
  if (error) {
    tooltip += `\nError: ${error}`
  }
  return tooltip
}

/**
 * Generate tooltip for stage progress bar in status banner
 * Shows stage info relative to current progress
 */
export function getStageProgressTooltip(
  stage: string,
  stageIndex: number,
  currentStageIndex: number,
  pipelineState?: string,
): string {
  const label = stageLabels[stage] || stage
  const isCompleted = currentStageIndex > stageIndex
  const isCurrent = currentStageIndex === stageIndex
  const isPaused = isCurrent && pipelineState === 'paused'

  let status = isCompleted
    ? '✓ Completed'
    : currentStageIndex < stageIndex
      ? '○ Pending'
      : '● In Progress'
  if (isPaused) status = '⏸ Paused'

  return `${label}: ${status}`
}

// ══════════════════════════════════════════════════════
// PIPELINE DISPLAY STATE — single source of truth for
// what MiniPipelineProgress and TaskList should render
// ══════════════════════════════════════════════════════

/**
 * Discriminated union describing exactly what to render for a task's pipeline progress.
 * Centralises all branching so both inline and bar variants render identically.
 */
export type PipelineDisplayState =
  | {
      kind: 'stage-progress'
      /** 0-based index in ALL_STAGES of the current running stage */
      stageIndex: number
      /** Human-readable label, e.g. "Building" */
      label: string
      /** 1-based step number */
      stepNumber: number
      /** Total stages count */
      totalStages: number
    }
  | {
      kind: 'gate-paused'
      /** 0-based index of the stage the pipeline is paused at */
      stageIndex: number
      /** Gate type when known */
      gateType?: 'hard-stop' | 'risk-gated'
      /** Stage label at pause point */
      label: string
    }
  | {
      /** Pipeline has started but currentStage not yet written — show shimmer */
      kind: 'starting'
    }
  | {
      /** No pipeline data — workflow run status is the best we have */
      kind: 'no-data'
      workflowStatus?: 'queued' | 'in_progress' | 'completed' | string
    }

/**
 * Derive the single canonical display state for a task's progress.
 *
 * Priority order:
 * 1. pipeline.state === 'paused'  → gate-paused
 * 2. pipeline running + currentStage → stage-progress
 * 3. pipeline running, no currentStage → starting (just kicked off)
 * 4. No pipeline → no-data (use workflow run status as fallback text)
 */
export function derivePipelineDisplayState(task: KodyTask): PipelineDisplayState {
  const pipeline = task.pipeline
  const gateType = task.gateType

  // Case 1: Pipeline is paused at a gate (regardless of task.column — may lag)
  if (pipeline?.state === 'paused') {
    // Find the highest completed/running stage as the pause point
    let pauseIdx = -1
    for (const [stageName, stageData] of Object.entries(pipeline.stages || {})) {
      if (stageData.state !== 'pending') {
        const idx = ALL_STAGES.indexOf(stageName as (typeof ALL_STAGES)[number])
        if (idx > pauseIdx) pauseIdx = idx
      }
    }
    // currentStage is more reliable if set
    if (pipeline.currentStage) {
      const idx = ALL_STAGES.indexOf(pipeline.currentStage as (typeof ALL_STAGES)[number])
      if (idx >= 0) pauseIdx = idx
    }
    const label =
      pauseIdx >= 0 ? stageLabels[ALL_STAGES[pauseIdx]] || ALL_STAGES[pauseIdx] : 'Approval'
    return { kind: 'gate-paused', stageIndex: pauseIdx, gateType, label }
  }

  // Case 2: Pipeline running with a known current stage
  if (pipeline?.state === 'running' && pipeline.currentStage) {
    const stageIndex = ALL_STAGES.indexOf(pipeline.currentStage as (typeof ALL_STAGES)[number])
    const label = stageLabels[pipeline.currentStage] || pipeline.currentStage
    const totalStages = ALL_STAGES.length
    const stepNumber = stageIndex >= 0 ? stageIndex + 1 : 1
    return { kind: 'stage-progress', stageIndex, label, stepNumber, totalStages }
  }

  // Case 3: Pipeline running but currentStage not yet set
  if (pipeline?.state === 'running') {
    // Defensive: derive position from stages data when currentStage is null
    if (pipeline.stages && Object.keys(pipeline.stages).length > 0) {
      // Walk stages in order: find the first with data that isn't completed/skipped.
      // Stages without data entries are skipped (they may not be tracked).
      let derivedStage: string | null = null
      let lastCompleted: string | null = null
      for (const stage of ALL_STAGES) {
        const data = pipeline.stages[stage]
        if (!data) continue // Stage not tracked — skip
        if (data.state === 'completed' || data.state === 'skipped') {
          lastCompleted = stage
          continue
        }
        // This stage has data but isn't done — it's the current position
        derivedStage = stage
        break
      }
      const resolvedStage = derivedStage || lastCompleted
      if (resolvedStage) {
        const stageIndex = ALL_STAGES.indexOf(resolvedStage as (typeof ALL_STAGES)[number])
        const label = stageLabels[resolvedStage] || resolvedStage
        const totalStages = ALL_STAGES.length
        const stepNumber = stageIndex >= 0 ? stageIndex + 1 : 1
        return { kind: 'stage-progress', stageIndex, label, stepNumber, totalStages }
      }
    }
    return { kind: 'starting' }
  }

  // Case 4: No pipeline data — fall back to workflow run status
  return { kind: 'no-data', workflowStatus: task.workflowRun?.status }
}

/**
 * Return a concise one-line sub-status description for a task in the task list.
 * Used to replace the ad-hoc inline status elements with a consistent format.
 *
 * Examples:
 *   "Building · 6/12"
 *   "Awaiting approval at Architecting"
 *   "Starting pipeline..."
 *   "Running"
 */
export function getTaskSubStatusText(task: KodyTask): string {
  const state = derivePipelineDisplayState(task)
  const total = ALL_STAGES.length

  switch (state.kind) {
    case 'stage-progress':
      return `${state.label} · ${state.stepNumber}/${total}`
    case 'gate-paused':
      return `Paused · ${state.label || 'Approval'}`
    case 'starting':
      return 'Starting pipeline...'
    case 'no-data': {
      const wf = state.workflowStatus
      if (wf === 'queued') return 'Queued...'
      if (wf === 'in_progress') return 'Running'
      return 'Starting...'
    }
  }
}
