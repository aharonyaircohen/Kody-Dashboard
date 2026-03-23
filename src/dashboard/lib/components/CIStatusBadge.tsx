/**
 * @fileType component
 * @domain kody
 * @pattern ci-status-badge
 * @ai-summary Shows CI status indicator for a PR and controls merge button state
 */
'use client'

import { usePRCIStatus } from '../hooks/usePRCIStatus'
import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react'
import { cn } from '../utils'
import { SimpleTooltip } from './SimpleTooltip'
import { CIStatusTooltipContent } from './tooltip-content'

interface CIStatusBadgeProps {
  prNumber: number
  className?: string
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-yellow-400', label: 'CI pending' },
  running: { icon: Loader2, color: 'text-blue-400', label: 'CI running', animate: true },
  success: { icon: CheckCircle2, color: 'text-emerald-400', label: 'CI passed' },
  failure: { icon: XCircle, color: 'text-red-400', label: 'CI failed' },
} as const

export function CIStatusBadge({ prNumber, className }: CIStatusBadgeProps) {
  const { data } = usePRCIStatus(prNumber)

  if (!data) return null

  const config = statusConfig[data.ciStatus]
  const Icon = config.icon

  return (
    <SimpleTooltip content={<CIStatusTooltipContent ciStatus={data.ciStatus} />} side="bottom">
      <span className={cn('inline-flex items-center gap-1', config.color, className)}>
        <Icon
          className={cn('w-3.5 h-3.5', 'animate' in config && config.animate && 'animate-spin')}
        />
      </span>
    </SimpleTooltip>
  )
}

/**
 * Hook-based helper — returns whether the merge button should be enabled
 */
export function useMergeEnabled(prNumber: number | undefined): {
  enabled: boolean
  ciStatus: 'pending' | 'success' | 'failure' | 'running' | undefined
} {
  const { data } = usePRCIStatus(prNumber)
  return {
    enabled: data?.mergeable ?? false,
    ciStatus: data?.ciStatus,
  }
}
