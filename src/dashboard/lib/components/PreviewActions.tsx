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
import { ConfirmDialog } from './ConfirmDialog'
import {
  XCircle,
  Wrench,
  Loader2,
  CheckCircle,
  GitPullRequest,
  Eye,
  Camera,
} from 'lucide-react'
import { tasksApi, prsApi } from '../api'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { usePRCIStatus } from '../hooks/usePRCIStatus'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '../utils'

/**
 * Optimistically add a label to this task in every cached tasks list, so the
 * approve buttons flip immediately after a successful action without waiting
 * for the next poll. Mirrors the backend, which adds the same label.
 */
function applyOptimisticLabel(
  queryClient: ReturnType<typeof useQueryClient>,
  issueNumber: number,
  label: string,
): void {
  queryClient.setQueriesData<KodyTask[]>({ queryKey: ['kody-tasks'] }, (old) =>
    old?.map((t) =>
      t.issueNumber === issueNumber && !t.labels?.includes(label)
        ? { ...t, labels: [...(t.labels ?? []), label] }
        : t,
    ),
  )
}

interface PreviewActionsProps {
  task: KodyTask
  onMerge: () => Promise<void>
  isMerging: boolean
  onCancelPR: () => void
  className?: string
}

export function PreviewActions({
  task,
  onMerge,
  isMerging,
  onCancelPR,
  className,
}: PreviewActionsProps) {
  const [showFixDialog, setShowFixDialog] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isApprovingUI, setIsApprovingUI] = useState(false)
  const [isApprovingPR, setIsApprovingPR] = useState(false)
  const { githubUser } = useGitHubIdentity()
  const queryClient = useQueryClient()

  const actorLogin = githubUser?.login

  // Check if UI / PR are already approved (label-driven, mirrors backend)
  const isUIApproved = task.labels?.includes('ui-approved')
  const isPRApproved = task.labels?.includes('pr-approved')

  const pr = task.associatedPR
  const { data: ciData } = usePRCIStatus(pr?.number)
  const hasConflicts = ciData?.hasConflicts ?? false
  const ciFailed = ciData?.ciStatus === 'failure'
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
    setIsApprovingUI(true)
    try {
      await tasksApi.approveUI(task.issueNumber, actorLogin)
      applyOptimisticLabel(queryClient, task.issueNumber, 'ui-approved')
      toast.success('Preview UI approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve UI')
    } finally {
      setIsApprovingUI(false)
    }
  }

  const handleApprovePR = async () => {
    setIsApprovingPR(true)
    try {
      await tasksApi.approvePR(task.issueNumber, actorLogin)
      applyOptimisticLabel(queryClient, task.issueNumber, 'pr-approved')
      toast.success('PR approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve PR')
    } finally {
      setIsApprovingPR(false)
    }
  }

  const postKodyCommand = async (command: string, successMessage: string) => {
    try {
      await prsApi.postComment(pr.number, command, actorLogin)
      toast.success(successMessage)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to post ${command}`)
    }
  }

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 px-4 py-3 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm max-h-[40vh] overflow-y-auto',
          className,
        )}
      >
        {/* ── Group: Approve & Merge (happy path) ── */}
        <div className="flex items-center gap-2" aria-label="Approve and merge">
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
              disabled={isApprovingUI}
              className="gap-1.5 cursor-pointer text-emerald-300 bg-emerald-500/10 border-emerald-500/40 shadow-sm shadow-emerald-500/10 transition-all hover:bg-emerald-500/20 hover:border-emerald-400/60 hover:text-emerald-200 hover:shadow-emerald-500/20 active:scale-[0.97]"
            >
              {isApprovingUI ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {isApprovingUI ? 'Approving…' : 'Approve UI'}
              </span>
            </Button>
          )}

          {/* Approve PR */}
          {isPRApproved ? (
            <div className="flex items-center gap-1.5 text-purple-400">
              <CheckCircle className="w-3.5 h-3.5" />
              <span className="text-xs hidden sm:inline">PR Approved</span>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleApprovePR}
              disabled={isApprovingPR}
              className="gap-1.5 cursor-pointer text-purple-300 bg-purple-500/10 border-purple-500/40 shadow-sm shadow-purple-500/10 transition-all hover:bg-purple-500/20 hover:border-purple-400/60 hover:text-purple-200 hover:shadow-purple-500/20 active:scale-[0.97]"
            >
              {isApprovingPR ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <GitPullRequest className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {isApprovingPR ? 'Approving…' : 'Approve PR'}
              </span>
            </Button>
          )}

          {/* Merge — hidden when PR has conflicts (Resolve takes its place) or CI failed (Fix CI takes its place) */}
          {!hasConflicts && !ciFailed && (
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
          )}
        </div>

        {/* Divider */}
        <span aria-hidden className="hidden sm:block w-px h-6 bg-zinc-800" />

        {/* ── Group: Review (inspect & request feedback) ── */}
        <div className="flex items-center gap-2" aria-label="Review">
          {/* Review — posts @kody review */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => postKodyCommand('@kody review', 'Review requested')}
            className="gap-1.5 cursor-pointer text-zinc-300 bg-transparent border-zinc-700 transition-all hover:bg-zinc-800/60 hover:border-zinc-600 hover:text-zinc-100 active:scale-[0.97]"
            title="Structured diff review"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Review</span>
          </Button>

          {/* UI Review — posts @kody ui-review */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => postKodyCommand('@kody ui-review', 'UI review requested')}
            className="gap-1.5 cursor-pointer text-zinc-300 bg-transparent border-zinc-700 transition-all hover:bg-zinc-800/60 hover:border-zinc-600 hover:text-zinc-100 active:scale-[0.97]"
            title="Playwright-based UI review"
          >
            <Camera className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">UI Review</span>
          </Button>
        </div>

        {/* Divider */}
        <span aria-hidden className="hidden sm:block w-px h-6 bg-zinc-800" />

        {/* ── Group: Fix (corrective) ── */}
        <div className="flex items-center gap-2" aria-label="Fix">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFixDialog(true)}
            className="gap-1.5 cursor-pointer text-orange-300 bg-orange-500/10 border-orange-500/40 shadow-sm shadow-orange-500/10 transition-all hover:bg-orange-500/20 hover:border-orange-400/60 hover:text-orange-200 hover:shadow-orange-500/20 active:scale-[0.97]"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Fix</span>
          </Button>
        </div>

        {/* Sync moved to BranchBehindBanner — only renders when behind base. */}

        {/* Cancel PR — destructive, pushed to the far right */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCancelConfirm(true)}
          disabled={isCancelling}
          className="gap-1.5 cursor-pointer text-red-300/80 bg-transparent border border-red-500/20 transition-all hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-200 active:scale-[0.97] ml-auto"
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
