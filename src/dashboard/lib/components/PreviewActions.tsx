/**
 * @fileType component
 * @domain kody
 * @pattern preview-actions
 * @ai-summary Sticky action bar for Preview: Approve (UI + auto-merge), Fix, Cancel PR
 */
"use client";

import { useState } from "react";
import type { KodyTask } from "../types";
import { Button } from "@dashboard/ui/button";
import { MergeButton } from "./MergeButton";
import { FixRequestDialog } from "./FixRequestDialog";
import { ReportIssueDialog } from "./ReportIssueDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { SimpleTooltip } from "./SimpleTooltip";
import {
  XCircle,
  Wrench,
  Loader2,
  CheckCircle,
  Eye,
  Camera,
  AlertTriangle,
} from "lucide-react";
import { tasksApi, prsApi } from "../api";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { usePRCIStatus } from "../hooks/usePRCIStatus";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "../utils";

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
  queryClient.setQueriesData<KodyTask[]>({ queryKey: ["kody-tasks"] }, (old) =>
    old?.map((t) =>
      t.issueNumber === issueNumber && !t.labels?.includes(label)
        ? { ...t, labels: [...(t.labels ?? []), label] }
        : t,
    ),
  );
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
  queryClient.setQueriesData<KodyTask[]>({ queryKey: ["kody-tasks"] }, (old) =>
    old?.map((t) =>
      t.issueNumber === issueNumber && t.labels?.includes(label)
        ? { ...t, labels: t.labels.filter((l) => l !== label) }
        : t,
    ),
  );
}

interface PreviewActionsProps {
  task: KodyTask;
  onMerge: () => Promise<void>;
  isMerging: boolean;
  onCancelPR: () => void;
  className?: string;
}

export function PreviewActions({
  task,
  onMerge,
  isMerging,
  onCancelPR,
  className,
}: PreviewActionsProps) {
  const [showFixDialog, setShowFixDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const { githubUser } = useGitHubIdentity();
  const queryClient = useQueryClient();

  const actorLogin = githubUser?.login;

  // Check if UI / PR are already approved (label-driven, mirrors backend)
  const isUIApproved = task.labels?.includes("ui-approved");
  const isPRApproved = task.labels?.includes("pr-approved");
  const hasNeedsFix = task.labels?.includes("kody:needs-fix");

  const pr = task.associatedPR;
  const { data: ciData } = usePRCIStatus(pr?.number);
  const hasConflicts = ciData?.hasConflicts ?? false;
  const ciFailed = ciData?.ciStatus === "failure";
  if (!pr) return null;

  const handleCancelPR = async () => {
    setIsCancelling(true);
    try {
      await tasksApi.closePR(task.issueNumber, actorLogin);
      toast.success("PR closed");
      onCancelPR();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to close PR");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleFixSubmit = async (description: string) => {
    try {
      await tasksApi.fixRequest(task.issueNumber, description, actorLogin);
      // Mirror the backend: clear terminal lifecycle labels and apply
      // kody:fixing so the task moves straight to "building" instead of
      // falling back to "review" while we wait for the engine to dispatch
      // the fix workflow.
      removeOptimisticLabel(queryClient, task.issueNumber, "kody:done");
      removeOptimisticLabel(queryClient, task.issueNumber, "kody:failed");
      applyOptimisticLabel(queryClient, task.issueNumber, "kody:fixing");
      toast.success("Fix requested — Kody will work on it");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to request fix");
      throw err; // re-throw so dialog keeps open
    }
  };

  /**
   * Single-step approval: marks both the UI and PR approved server-side,
   * then fires the merge if the PR is already mergeable (CI green, no
   * conflicts). When CI is still pending the MergeButton stays visible so
   * the user can click again once checks finish — no separate "Approve PR"
   * gate, since we don't run a separate code-review pass right now.
   */
  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await Promise.all([
        tasksApi.approveUI(task.issueNumber, actorLogin),
        tasksApi.approvePR(task.issueNumber, actorLogin),
      ]);
      applyOptimisticLabel(queryClient, task.issueNumber, "ui-approved");
      applyOptimisticLabel(queryClient, task.issueNumber, "pr-approved");
      // Backend also clears kody:needs-fix — mirror that locally so the
      // task list flips to the approved icon immediately.
      removeOptimisticLabel(queryClient, task.issueNumber, "kody:needs-fix");

      const mergeableNow =
        (ciData?.mergeable ?? false) && !hasConflicts && !ciFailed;
      if (mergeableNow) {
        toast.success("Approved — merging");
        await onMerge();
      } else {
        toast.success("Approved — merge will run when CI passes");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setIsApproving(false);
    }
  };

  const handleReportIssue = async (notes: string) => {
    try {
      await tasksApi.reportIssue(task.issueNumber, notes, actorLogin);
      applyOptimisticLabel(queryClient, task.issueNumber, "kody:needs-fix");
      // Mirror the backend, which also clears terminal lifecycle labels so the
      // task immediately leaves the "completed" column.
      removeOptimisticLabel(queryClient, task.issueNumber, "kody:done");
      removeOptimisticLabel(queryClient, task.issueNumber, "kody:failed");
      toast.success("Issue reported");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to report issue",
      );
      throw err; // re-throw so dialog keeps open
    }
  };

  const postKodyCommand = async (command: string, successMessage: string) => {
    try {
      await prsApi.postComment(pr.number, command, actorLogin);
      toast.success(successMessage);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to post ${command}`,
      );
    }
  };

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm max-h-[40vh] overflow-y-auto",
          className,
        )}
      >
        {/* ── Approval row: horizontal, progressive disclosure ── */}
        <div
          className="flex flex-row items-center gap-1.5"
          aria-label="Approve and merge"
        >
          {/* Approve — one button: labels UI + PR approved server-side, then
              fires the merge if CI is already green. */}
          {isUIApproved ? (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="gap-1.5 text-emerald-400 bg-transparent border-emerald-900/60 disabled:opacity-100"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Approved</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleApprove}
              disabled={isApproving}
              className="gap-1.5 cursor-pointer text-zinc-200 bg-transparent border-zinc-700 transition-all hover:bg-zinc-800/60 hover:border-zinc-600 hover:text-zinc-50 active:scale-[0.97]"
            >
              {isApproving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              <span>{isApproving ? "Approving…" : "Approve"}</span>
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
                "gap-1.5 cursor-pointer bg-transparent transition-all active:scale-[0.97]",
                hasNeedsFix
                  ? "text-red-300 border-red-900/60 hover:bg-red-500/10 hover:border-red-700"
                  : "text-zinc-200 border-zinc-700 hover:bg-zinc-800/60 hover:border-zinc-600 hover:text-zinc-50",
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{hasNeedsFix ? "Issue reported" : "Report Issue"}</span>
            </Button>
          )}

          {/* Merge — visible after Approve (which also sets pr-approved).
              Kept as a manual fallback so the user can re-fire the merge if
              CI was still pending at approval time. */}
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
              onClick={() =>
                postKodyCommand("@kody review", "Review requested")
              }
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
              onClick={() =>
                postKodyCommand("@kody ui-review", "UI review requested")
              }
              className="h-8 w-8 cursor-pointer text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 active:scale-[0.97]"
              aria-label="UI Review"
            >
              <Camera className="w-4 h-4" />
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
  );
}
