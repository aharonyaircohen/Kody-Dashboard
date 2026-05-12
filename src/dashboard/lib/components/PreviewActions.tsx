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
import { ReportIssueDialog } from './ReportIssueDialog'
import { QARequestDialog } from './QARequestDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { SimpleTooltip } from './SimpleTooltip'
import {
  XCircle,
  Wrench,
  Loader2,
  CheckCircle,
  GitPullRequest,
  Eye,
  Camera,
  AlertTriangle,
  Stethoscope,
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

/**
 * Optimistically remove a label across all cached task lists. Mirrors the
 * backend, which removes the label as part of the same action.
 */
function removeOptimisticLabel(
  queryClient: ReturnType<typeof useQueryClient>,
  issueNumber: number,
  label: string,
): void {
  queryClient.setQueriesData<KodyTask[]>({ queryKey: ['kody-tasks'] }, (old) =>
    old?.map((t) =>
      t.issueNumber === issueNumber && t.labels?.includes(label)
        ? { ...t, labels: t.labels.filter((l) => l !== label) }
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
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [showQADialog, setShowQADialog] = useState(false)
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
  const hasNeedsFix = task.labels?.includes('kody:needs-fix')

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
      // Mirror the backend, which also clears terminal lifecycle labels so the
      // task immediately leaves the "completed" column while we wait for the
      // engine to dispatch the fix workflow.
      removeOptimisticLabel(queryClient, task.issueNumber, 'kody:done')
      removeOptimisticLabel(queryClient, task.issueNumber, 'kody:failed')
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
      // Backend also clears kody:needs-fix — mirror that locally so the
      // task list flips to the approved icon immediately.
      removeOptimisticLabel(queryClient, task.issueNumber, 'kody:needs-fix')
      toast.success('Preview UI approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve UI')
    } finally {
      setIsApprovingUI(false)
    }
  }

  const handleReportIssue = async (notes: string) => {
    try {
      await tasksApi.reportIssue(task.issueNumber, notes, actorLogin)
      applyOptimisticLabel(queryClient, task.issueNumber, 'kody:needs-fix')
      // Mirror the backend, which also clears terminal lifecycle labels so the
      // task immediately leaves the "completed" column.
      removeOptimisticLabel(queryClient, task.issueNumber, 'kody:done')
      removeOptimisticLabel(queryClient, task.issueNumber, 'kody:failed')
      toast.success('Issue reported')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to report issue')
      throw err // re-throw so dialog keeps open
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

  /**
   * QA the completed task: post `@kody qa-engineer` on the *issue* (not the
   * PR). The dispatcher auto-binds the issue number to qa-engineer's `issue`
   * input, qa-engineer browses the configured QA URL, and the postflight
   * comments the PASS/CONCERNS/FAIL report back on the same issue.
   *
   * `scope` is optional — empty string runs a broad smoke pass; a non-empty
   * value gets passed as `--scope "<text>"` to narrow the focus.
   */
  const handleRunQA = async (scope: string) => {
    // Escape any double quotes the user typed so the shell-style flag stays valid.
    const safeScope = scope.replace(/"/g, '\\"')
    const command = safeScope
      ? `@kody qa-engineer --scope "${safeScope}"`
      : '@kody qa-engineer'
    try {
      await tasksApi.comment(task.issueNumber, command, actorLogin)
      toast.success('QA requested — report will appear as a comment')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to request QA')
      throw err // re-throw so dialog keeps open on failure
    }
  }

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm max-h-[40vh] overflow-y-auto',
          className,
        )}
      >
        {/* ── Approval row: horizontal, progressive disclosure ── */}
        <div className="flex flex-row items-center gap-1.5" aria-label="Approve and merge">
          {/* Step 1: Approve UI — visible until done */}
          {isUIApproved ? (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="gap-1.5 text-emerald-400 bg-transparent border-emerald-900/60 disabled:opacity-100"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>UI Approved</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleApproveUI}
              disabled={isApprovingUI}
              className="gap-1.5 cursor-pointer text-zinc-200 bg-transparent border-zinc-700 transition-all hover:bg-zinc-800/60 hover:border-zinc-600 hover:text-zinc-50 active:scale-[0.97]"
            >
              {isApprovingUI ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              <span>{isApprovingUI ? 'Approving…' : 'Approve UI'}</span>
            </Button>
          )}

          {/* Report Issue — peer to Approve UI; visible until UI is approved.
              QA can use this to flag unresolved problems with documentation. */}
          {!isUIApproved && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowReportDialog(true)}
              className={cn(
                'gap-1.5 cursor-pointer bg-transparent transition-all active:scale-[0.97]',
                hasNeedsFix
                  ? 'text-red-300 border-red-900/60 hover:bg-red-500/10 hover:border-red-700'
                  : 'text-zinc-200 border-zinc-700 hover:bg-zinc-800/60 hover:border-zinc-600 hover:text-zinc-50',
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{hasNeedsFix ? 'Issue reported' : 'Report Issue'}</span>
            </Button>
          )}

          {/* Step 2: Approve PR — only visible after UI approved */}
          {isUIApproved &&
            (isPRApproved ? (
              <Button
                variant="outline"
                size="sm"
                disabled
                className="gap-1.5 text-emerald-400 bg-transparent border-emerald-900/60 disabled:opacity-100"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>PR Approved</span>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleApprovePR}
                disabled={isApprovingPR}
                className="gap-1.5 cursor-pointer text-zinc-200 bg-transparent border-zinc-700 transition-all hover:bg-zinc-800/60 hover:border-zinc-600 hover:text-zinc-50 active:scale-[0.97]"
              >
                {isApprovingPR ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <GitPullRequest className="w-3.5 h-3.5" />
                )}
                <span>{isApprovingPR ? 'Approving…' : 'Approve PR'}</span>
              </Button>
            ))}

          {/* Step 3: Merge — only visible after both approvals */}
          {isUIApproved && isPRApproved && !hasConflicts && !ciFailed && (
            <MergeButton
              prNumber={pr.number}
              prTitle={pr.title}
              branchName={pr.head.ref}
              isMerging={isMerging}
              onMerge={onMerge}
              labels={task.labels}
            />
          )}
        </div>

        {/* Divider */}
        <span aria-hidden className="self-stretch w-px bg-zinc-800" />

        {/* ── Icon-only secondary actions ── */}
        <div className="flex items-center gap-1.5">
          <SimpleTooltip content="Structured diff review">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => postKodyCommand('@kody review', 'Review requested')}
              className="h-8 w-8 cursor-pointer text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 active:scale-[0.97]"
              aria-label="Review"
            >
              <Eye className="w-4 h-4" />
            </Button>
          </SimpleTooltip>

          <SimpleTooltip content="Playwright-based UI review">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => postKodyCommand('@kody ui-review', 'UI review requested')}
              className="h-8 w-8 cursor-pointer text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 active:scale-[0.97]"
              aria-label="UI Review"
            >
              <Camera className="w-4 h-4" />
            </Button>
          </SimpleTooltip>

          <SimpleTooltip content="QA the completed task">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowQADialog(true)}
              className="h-8 w-8 cursor-pointer text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 active:scale-[0.97]"
              aria-label="QA"
            >
              <Stethoscope className="w-4 h-4" />
            </Button>
          </SimpleTooltip>

          <SimpleTooltip content="Request a fix">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowFixDialog(true)}
              className="h-8 w-8 cursor-pointer text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 active:scale-[0.97]"
              aria-label="Fix"
            >
              <Wrench className="w-4 h-4" />
            </Button>
          </SimpleTooltip>
        </div>

        {/* Sync moved to BranchBehindBanner — only renders when behind base. */}

        {/* Cancel PR — destructive icon-only, far right */}
        <SimpleTooltip content="Cancel PR">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowCancelConfirm(true)}
            disabled={isCancelling}
            className="h-8 w-8 cursor-pointer text-red-300/70 hover:bg-red-500/10 hover:text-red-200 active:scale-[0.97] ml-auto"
            aria-label="Cancel PR"
          >
            {isCancelling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
          </Button>
        </SimpleTooltip>
      </div>

      <FixRequestDialog
        isOpen={showFixDialog}
        onClose={() => setShowFixDialog(false)}
        onSubmit={handleFixSubmit}
        prNumber={pr.number}
      />

      <ReportIssueDialog
        isOpen={showReportDialog}
        onClose={() => setShowReportDialog(false)}
        onSubmit={handleReportIssue}
        issueNumber={task.issueNumber}
      />

      <QARequestDialog
        isOpen={showQADialog}
        onClose={() => setShowQADialog(false)}
        onSubmit={handleRunQA}
        issueNumber={task.issueNumber}
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
