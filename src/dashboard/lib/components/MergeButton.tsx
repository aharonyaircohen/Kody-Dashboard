/**
 * @fileType component
 * @domain kody
 * @pattern merge-button
 * @ai-summary Merge button that opens approval dialog with CI status and file changes
 */
'use client'

import React, { useState } from 'react'
import { Button } from '@dashboard/ui/button'
import { GitPullRequest, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react'
import { usePRCIStatus } from '../hooks/usePRCIStatus'
import { MergeApprovalDialog } from './MergeApprovalDialog'
import { SimpleTooltip } from './SimpleTooltip'
import { MergeTooltipContent } from './tooltip-content'
import { cn } from '../utils'
import { toast } from 'sonner'

interface MergeButtonProps {
  prNumber: number
  prTitle?: string
  branchName?: string
  isMerging: boolean
  onMerge: () => Promise<void>
  labels?: string[]
}

const ciIcons = {
  pending: { icon: Clock, color: 'text-yellow-400', spin: false },
  running: { icon: Loader2, color: 'text-blue-400', spin: true },
  success: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    spin: false,
  },
  failure: { icon: XCircle, color: 'text-red-400', spin: false },
} as const

export function MergeButton({
  prNumber,
  prTitle = '',
  branchName,
  isMerging: externalIsMerging,
  onMerge,
  labels = [],
}: MergeButtonProps) {
  const [showDialog, setShowDialog] = useState(false)
  const { data, isLoading, isError } = usePRCIStatus(prNumber)

  const isMerging = externalIsMerging
  const ciStatus = isError ? 'failure' : (data?.ciStatus ?? 'pending')
  const canMerge = data?.mergeable ?? false
  const hasConflicts = data?.hasConflicts ?? false
  const config = ciIcons[ciStatus]
  // Show warning triangle for conflicts instead of the CI status X icon
  const CIIcon = hasConflicts ? AlertTriangle : config.icon

  // Check approval status
  const isUIApproved = labels.includes('ui-approved')
  const isPRApproved = labels.includes('pr-approved')
  const isApproved = isUIApproved && isPRApproved

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!canMerge || isMerging || isLoading || !isApproved) return
    setShowDialog(true)
  }

  // Prevent click from propagating to task row even when disabled
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleMerged = async () => {
    try {
      await onMerge()
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Merge failed'
      toast.error(`Merge failed: ${msg}`)
    }
  }

  return (
    <>
      <SimpleTooltip
        content={
          <MergeTooltipContent
            canMerge={canMerge}
            ciStatus={ciStatus}
            isMerging={isMerging}
            hasConflicts={hasConflicts}
            isApproved={isApproved}
          />
        }
        side="bottom"
      >
        {/* Wrap in span so tooltip works even when button is disabled (disabled elements block pointer events) */}
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            disabled={isMerging || !canMerge || isLoading || !isApproved}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            className={cn(
              'h-8 text-sm px-2.5 gap-1.5 border transition-all disabled:opacity-50',
              isApproved && canMerge
                ? 'text-zinc-900 bg-zinc-100 border-zinc-200 shadow-md hover:bg-white hover:border-white hover:shadow-zinc-100/30 active:scale-[0.97] cursor-pointer'
                : 'text-muted-foreground bg-muted/30 border-transparent cursor-not-allowed',
            )}
          >
            {isMerging ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <CIIcon
                  className={cn(
                    'w-3.5 h-3.5',
                    hasConflicts ? 'text-orange-400' : config.color,
                    config.spin && !hasConflicts && 'animate-spin',
                  )}
                />
                <GitPullRequest className="w-4 h-4" />
              </>
            )}
          </Button>
        </span>
      </SimpleTooltip>

      <MergeApprovalDialog
        prNumber={prNumber}
        prTitle={prTitle}
        branchName={branchName}
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        onMerged={handleMerged}
      />
    </>
  )
}
