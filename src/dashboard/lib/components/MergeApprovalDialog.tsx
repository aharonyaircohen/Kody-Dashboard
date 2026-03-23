/**
 * @fileType component
 * @domain kody
 * @pattern merge-approval-dialog
 * @ai-summary Dialog for approving and merging a PR with CI status and file changes
 */
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@dashboard/ui/dialog'
import { GitPullRequest, Loader2, CheckCircle2, XCircle, Clock, FileText } from 'lucide-react'
import { usePRCIStatus } from '../hooks/usePRCIStatus'
import { cn } from '../utils'

interface MergeApprovalDialogProps {
  prNumber: number
  prTitle: string
  branchName?: string
  isOpen: boolean
  onClose: () => void
  onMerged: () => void
}

interface PRFiles {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed'
  additions: number
  deletions: number
}

const ciIcons = {
  pending: {
    icon: Clock,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/20',
    title: 'CI pending…',
    spin: false,
  },
  running: {
    icon: Loader2,
    color: 'text-blue-400',
    bg: 'bg-blue-500/20',
    title: 'CI running…',
    spin: true,
  },
  success: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/20',
    title: 'CI passed',
    spin: false,
  },
  failure: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/20',
    title: 'CI failed',
    spin: false,
  },
} as const

export function MergeApprovalDialog({
  prNumber,
  prTitle,
  branchName,
  isOpen,
  onClose,
  onMerged,
}: MergeApprovalDialogProps) {
  const { data: ciData, isLoading: ciLoading } = usePRCIStatus(prNumber)
  const [files, setFiles] = useState<PRFiles[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [isMerging, setIsMerging] = useState(false)

  const ciStatus = ciData?.ciStatus ?? 'pending'
  const canMerge = ciData?.mergeable ?? false
  const ciConfig = ciIcons[ciStatus]
  const CIIcon = ciConfig.icon

  // Fetch PR files when dialog opens
  useEffect(() => {
    if (isOpen && prNumber) {
      setFilesLoading(true)
      fetch(`/api/kody/prs/files?prNumber=${prNumber}`)
        .then((res) => res.json())
        .then((data) => {
          setFiles(data.files || [])
        })
        .catch(console.error)
        .finally(() => setFilesLoading(false))
    }
  }, [isOpen, prNumber])

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

  const handleMerge = async () => {
    if (!canMerge) return

    setIsMerging(true)
    try {
      // Find the task by PR number and call approveReview
      // For now, we'll call a simplified endpoint - the caller handles the actual merge
      await onMerged()
      onClose()
    } catch (error) {
      console.error('Merge failed:', error)
    } finally {
      setIsMerging(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="w-5 h-5 text-purple-500" />
            Approve & Merge PR #{prNumber}
          </DialogTitle>
          <DialogDescription className="text-foreground">{prTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* CI Status */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <span className="text-sm font-medium">CI Status</span>
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full', ciConfig.bg)}>
              {ciLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : (
                <CIIcon
                  className={cn('w-4 h-4', ciConfig.color, ciConfig.spin && 'animate-spin')}
                />
              )}
              <span className={cn('text-sm font-medium', ciConfig.color)}>
                {ciLoading ? 'Loading...' : ciConfig.title}
              </span>
            </div>
          </div>

          {/* Branch info */}
          {branchName && (
            <div className="p-3 rounded-lg bg-muted/50">
              <span className="text-xs text-muted-foreground uppercase">Branch</span>
              <p className="text-sm font-mono mt-1">{branchName}</p>
            </div>
          )}

          {/* File changes summary */}
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {filesLoading ? 'Loading files...' : `${files.length} files changed`}
              </span>
            </div>
            {!filesLoading && files.length > 0 && (
              <div className="flex gap-4 text-xs">
                <span className="text-emerald-500">+{totalAdditions}</span>
                <span className="text-red-500">-{totalDeletions}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose} disabled={isMerging}>
            Cancel
          </Button>
          <Button
            onClick={handleMerge}
            disabled={!canMerge || ciLoading || isMerging}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isMerging ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Approve & Merge
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
