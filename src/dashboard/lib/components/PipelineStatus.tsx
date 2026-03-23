/**
 * @fileType component
 * @domain kody
 * @pattern pipeline-status
 * @ai-summary Vertical stepper pipeline status for narrow sidebar
 */
'use client'

import { useState } from 'react'
import { cn, formatDuration } from '../utils'
import type { KodyPipelineStatus, StageStatus } from '../types'
import { SPEC_STAGES, IMPL_STAGES } from '../constants'
import { StageErrorDetail } from './StageErrorDetail'
import { Check, Circle, Loader2, X, Pause } from 'lucide-react'
import { stageLabels, getStageTooltip } from '../pipeline-utils'
import { SimpleTooltip } from './SimpleTooltip'

interface PipelineStatusProps {
  status: KodyPipelineStatus
  className?: string
}

export function PipelineStatus({ status, className }: PipelineStatusProps) {
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({})

  const toggleStage = (stage: string) => {
    setExpandedStages((prev) => ({
      ...prev,
      [stage]: !prev[stage],
    }))
  }

  // Find failed stage for error details
  const failedStage = Object.entries(status.stages).find(
    ([, data]) => data?.state === 'failed' || data?.state === 'timeout',
  )

  return (
    <div className={cn('space-y-3', className)}>
      {/* Spec Pipeline */}
      <div>
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Spec
        </h4>
        <div className="border-l border-zinc-700/50 ml-[7px] pl-3 space-y-0.5">
          {SPEC_STAGES.map((stage) => {
            const stageData = status.stages[stage]
            const isFailed = stageData?.state === 'failed' || stageData?.state === 'timeout'
            return (
              <StageRow
                key={stage}
                stage={stage}
                data={stageData}
                expandable={isFailed}
                expanded={expandedStages[stage] || false}
                onToggle={() => toggleStage(stage)}
              />
            )
          })}
        </div>
      </div>

      {/* Implementation Pipeline */}
      <div>
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Implementation
        </h4>
        <div className="border-l border-zinc-700/50 ml-[7px] pl-3 space-y-0.5">
          {IMPL_STAGES.map((stage) => {
            const stageData = status.stages[stage]
            const isFailed = stageData?.state === 'failed' || stageData?.state === 'timeout'
            return (
              <StageRow
                key={stage}
                stage={stage}
                data={stageData}
                expandable={isFailed}
                expanded={expandedStages[stage] || false}
                onToggle={() => toggleStage(stage)}
              />
            )
          })}
        </div>
      </div>

      {/* Error Details - show for failed/timeout stages */}
      {failedStage && (
        <StageErrorDetail
          stageName={failedStage[0]}
          error={failedStage[1]?.error}
          runId={status.runId ? parseInt(status.runId) : undefined}
        />
      )}
    </div>
  )
}

interface StageRowProps {
  stage: string
  data?: StageStatus
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
}

function StageRow({ stage, data, expandable, expanded, onToggle }: StageRowProps) {
  const state = data?.state || 'pending'
  const label = stageLabels[stage] || stage
  const elapsed = data?.elapsed

  const tooltipContent = getStageTooltip(stage, data)

  return (
    <div className="relative">
      {/* Row content */}
      <SimpleTooltip content={tooltipContent} side="right">
        <div
          className={cn(
            'flex items-center gap-2 py-0.5 group',
            expandable && 'cursor-pointer hover:bg-white/5 rounded px-1 -mx-1',
          )}
          onClick={expandable ? onToggle : undefined}
        >
          {/* Icon */}
          <div className="w-4 h-4 flex items-center justify-center shrink-0 relative z-10">
            {state === 'completed' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
            {state === 'running' && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />}
            {state === 'paused' && <Pause className="w-3 h-3 text-yellow-400" />}
            {state === 'gate-waiting' && <Pause className="w-3 h-3 text-yellow-400" />}
            {(state === 'failed' || state === 'timeout') && (
              <X className="w-3.5 h-3.5 text-red-400" />
            )}
            {state === 'skipped' && <Circle className="w-2.5 h-2.5 text-zinc-600" />}
            {state === 'pending' && <Circle className="w-2.5 h-2.5 text-zinc-700" />}
          </div>

          {/* Label */}
          <span
            className={cn(
              'text-xs truncate flex-1',
              state === 'completed' && 'text-zinc-400',
              state === 'running' && 'text-blue-400 font-medium',
              state === 'paused' && 'text-yellow-400 font-medium',
              state === 'gate-waiting' && 'text-yellow-400 font-medium',
              (state === 'failed' || state === 'timeout') && 'text-red-400',
              state === 'skipped' && 'text-zinc-600 line-through',
              state === 'pending' && 'text-zinc-600',
            )}
          >
            {label}
          </span>

          {/* Duration (completed stages only) */}
          {state === 'completed' && elapsed && (
            <span className="text-[10px] text-zinc-600 font-mono tabular-nums">
              {formatDuration(elapsed * 1000)}
            </span>
          )}

          {/* Running indicator */}
          {state === 'running' && <span className="text-[10px] text-blue-400/70">running</span>}

          {/* Expand chevron for failed stages */}
          {expandable && <span className="text-zinc-500">{expanded ? '−' : '+'}</span>}
        </div>
      </SimpleTooltip>

      {/* Expanded error detail for failed stages */}
      {expandable && expanded && (state === 'failed' || state === 'timeout') && data?.error && (
        <div className="ml-5 mt-1 mb-2 text-xs text-red-400 bg-red-500/10 rounded p-2 border border-red-500/20">
          {data.error}
        </div>
      )}
    </div>
  )
}
