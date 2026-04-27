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
import {
  XCircle,
  Wrench,
  Loader2,
  CheckCircle,
  GitPullRequest,
  MessageSquare,
  Eye,
  Camera,
  RefreshCw,
  GitMerge,
  ChevronDown,
} from 'lucide-react'
import { tasksApi, prsApi } from '../api'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@dashboard/ui/dropdown-menu'
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
    try {
      await tasksApi.approveUI(task.issueNumber, actorLogin)
      applyOptimisticLabel(queryClient, task.issueNumber, 'ui-approved')
      toast.success('Preview UI approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve UI')
    }
  }

  const handleApprovePR = async () => {
    try {
      await tasksApi.approvePR(task.issueNumber, actorLogin)
      applyOptimisticLabel(queryClient, task.issueNumber, 'pr-approved')
      toast.success('PR approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve PR')
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
          'flex flex-wrap items-center gap-2 px-4 py-3 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm max-h-[40vh] overflow-y-auto',
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
            className="gap-1.5 cursor-pointer text-emerald-300 bg-emerald-500/10 border-emerald-500/40 shadow-sm shadow-emerald-500/10 transition-all hover:bg-emerald-500/20 hover:border-emerald-400/60 hover:text-emerald-200 hover:shadow-emerald-500/20 active:scale-[0.97]"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Approve UI</span>
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
            className="gap-1.5 cursor-pointer text-purple-300 bg-purple-500/10 border-purple-500/40 shadow-sm shadow-purple-500/10 transition-all hover:bg-purple-500/20 hover:border-purple-400/60 hover:text-purple-200 hover:shadow-purple-500/20 active:scale-[0.97]"
          >
            <GitPullRequest className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Approve PR</span>
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

        {/* Fix */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFixDialog(true)}
          className="gap-1.5 cursor-pointer text-orange-300 bg-orange-500/10 border-orange-500/40 shadow-sm shadow-orange-500/10 transition-all hover:bg-orange-500/20 hover:border-orange-400/60 hover:text-orange-200 hover:shadow-orange-500/20 active:scale-[0.97]"
        >
          <Wrench className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Fix</span>
        </Button>

        {/* Review — posts @kody review */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => postKodyCommand('@kody review', 'Review requested')}
          className="gap-1.5 cursor-pointer text-indigo-200 bg-indigo-500/10 border-indigo-500/40 shadow-sm shadow-indigo-500/10 transition-all hover:bg-indigo-500/20 hover:border-indigo-400/60 hover:text-indigo-100 hover:shadow-indigo-500/20 active:scale-[0.97]"
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
          className="gap-1.5 cursor-pointer text-pink-200 bg-pink-500/10 border-pink-500/40 shadow-sm shadow-pink-500/10 transition-all hover:bg-pink-500/20 hover:border-pink-400/60 hover:text-pink-100 hover:shadow-pink-500/20 active:scale-[0.97]"
          title="Playwright-based UI review"
        >
          <Camera className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">UI Review</span>
        </Button>

        {/* Sync — posts @kody sync */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => postKodyCommand('@kody sync', 'Sync requested')}
          className="gap-1.5 cursor-pointer text-cyan-200 bg-cyan-500/10 border-cyan-500/40 shadow-sm shadow-cyan-500/10 transition-all hover:bg-cyan-500/20 hover:border-cyan-400/60 hover:text-cyan-100 hover:shadow-cyan-500/20 active:scale-[0.97]"
          title="Merge default branch into PR branch"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sync</span>
        </Button>

        {/* Resolve — only when there are merge conflicts; replaces Merge */}
        {hasConflicts && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 cursor-pointer text-orange-200 bg-orange-500/10 border-orange-500/40 shadow-sm shadow-orange-500/10 transition-all hover:bg-orange-500/20 hover:border-orange-400/60 hover:text-orange-100 hover:shadow-orange-500/20 active:scale-[0.97]"
                title="Resolve merge conflicts"
              >
                <GitMerge className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Resolve</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  postKodyCommand('@kody resolve', 'Resolve requested')
                }
              >
                Auto
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  postKodyCommand(
                    '@kody resolve --prefer ours',
                    'Resolve requested (prefer mine)',
                  )
                }
              >
                Prefer mine (PR branch)
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  postKodyCommand(
                    '@kody resolve --prefer theirs',
                    'Resolve requested (prefer base)',
                  )
                }
              >
                Prefer base
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Comment */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCommentDialog(true)}
          className="gap-1.5 cursor-pointer text-blue-300 bg-blue-500/10 border-blue-500/40 shadow-sm shadow-blue-500/10 transition-all hover:bg-blue-500/20 hover:border-blue-400/60 hover:text-blue-200 hover:shadow-blue-500/20 active:scale-[0.97]"
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
          className="gap-1.5 cursor-pointer text-red-300 bg-red-500/10 border-red-500/40 shadow-sm shadow-red-500/10 transition-all hover:bg-red-500/20 hover:border-red-400/60 hover:text-red-200 hover:shadow-red-500/20 active:scale-[0.97] ml-auto"
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
