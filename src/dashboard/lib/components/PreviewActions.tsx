/**
 * @fileType component
 * @domain kody
 * @pattern preview-actions
 * @ai-summary Sticky action bar for Preview: Approve UI, Approve PR, Merge, Fix, Cancel PR
 */
'use client'

import { useState } from 'react'
import type { KodyTask } from '../types'
import { Button } from '@dashboard/ui/button'
import { MergeButton } from './MergeButton'
import { FixRequestDialog } from './FixRequestDialog'
import { AddCommentDialog } from './AddCommentDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { XCircle, Wrench, Loader2, CheckCircle, GitPullRequest, MessageSquare } from 'lucide-react'
import { tasksApi, prsApi } from '../api'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { toast } from 'sonner'
import { cn } from '../utils'

interface PreviewActionsProps {
  task: KodyTask
  onMerge: () => Promise<void>
  isMerging: boolean
  onCancelPR: () => void
  onCommentAdded?: () => void
  className?: string
}

export function PreviewActions({
  task,
  onMerge,
  isMerging,
  onCancelPR,
  onCommentAdded,
  className,
}: PreviewActionsProps) {
  const [showFixDialog, setShowFixDialog] = useState(false)
  const [showCommentDialog, setShowCommentDialog] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const { githubUser } = useGitHubIdentity()

  const actorLogin = githubUser?.login

  // Check if UI is already approved
  const isUIApproved = task.labels?.includes('ui-approved')

  const pr = task.associatedPR
  if (!pr) return null

  const handleCancelPR = async () => {
    setIsCancelling(true)
    try {
      await tasksApi.closePR(task.issueNumber, actorLogin)
      toast.success('PR closed')
      onCancelPR()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close PR')
    } finally {
      setIsCancelling(false)
    }
  }

  const handleFixSubmit = async (description: string) => {
    try {
      await tasksApi.fixRequest(task.issueNumber, description, actorLogin)
      toast.success('Fix requested — Kody will work on it')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to request fix')
      throw err // re-throw so dialog keeps open
    }
  }

  const handleApproveUI = async () => {
    try {
      await tasksApi.approveUI(task.issueNumber, actorLogin)
      toast.success('Preview UI approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve UI')
    }
  }

  const handleApprovePR = async () => {
    try {
      await tasksApi.approvePR(task.issueNumber, actorLogin)
      toast.success('PR approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve PR')
    }
  }

  const handleCommentSubmit = async (body: string) => {
    try {
      await prsApi.postComment(pr.number, body, actorLogin)
      toast.success('Comment added')
      onCommentAdded?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add comment')
      throw err // re-throw so dialog keeps open
    }
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-3 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm',
          className,
        )}
      >
        {/* Approve UI */}
        {isUIApproved ? (
          <div className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle className="w-3.5 h-3.5" />
            <span className="text-xs hidden sm:inline">UI Approved</span>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleApproveUI}
            className="gap-1.5 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Approve UI</span>
          </Button>
        )}

        {/* Approve PR */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleApprovePR}
          className="gap-1.5 text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
        >
          <GitPullRequest className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Approve PR</span>
        </Button>

        {/* Merge */}
        <div className="flex items-center gap-1.5">
          <MergeButton
            prNumber={pr.number}
            prTitle={pr.title}
            branchName={pr.head.ref}
            isMerging={isMerging}
            onMerge={onMerge}
            labels={task.labels}
          />
          <span className="text-xs text-zinc-500 hidden sm:inline">Merge</span>
        </div>

        {/* Fix */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFixDialog(true)}
          className="gap-1.5 text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
        >
          <Wrench className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Fix</span>
        </Button>

        {/* Comment */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCommentDialog(true)}
          className="gap-1.5 text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Comment</span>
        </Button>

        {/* Cancel PR */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCancelConfirm(true)}
          disabled={isCancelling}
          className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10 ml-auto"
        >
          {isCancelling ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <XCircle className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">Cancel PR</span>
        </Button>
      </div>

      <FixRequestDialog
        isOpen={showFixDialog}
        onClose={() => setShowFixDialog(false)}
        onSubmit={handleFixSubmit}
        prNumber={pr.number}
      />

      <AddCommentDialog
        isOpen={showCommentDialog}
        onClose={() => setShowCommentDialog(false)}
        onSubmit={handleCommentSubmit}
        prNumber={pr.number}
      />

      <ConfirmDialog
        open={showCancelConfirm}
        title="Close PR"
        description="Close this PR? The branch will remain but the PR will be closed."
        confirmLabel="Close PR"
        variant="destructive"
        onConfirm={handleCancelPR}
        onClose={() => setShowCancelConfirm(false)}
      />
    </>
  )
}
