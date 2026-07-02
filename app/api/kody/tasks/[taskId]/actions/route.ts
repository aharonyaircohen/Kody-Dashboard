/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern task-actions-api
 * @ai-summary API route for task actions (approve, reject, rerun, abort, execute)
 *   Uses per-user GitHub token when available for proper attribution.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";

import {
  postComment,
  cancelWorkflowRun,
  fetchComments,
  fetchIssue,
  fetchWorkflowRuns,
  updateIssue,
  addAssignees,
  removeAssignees,
  addLabels,
  removeLabel,
  ensureLabel,
  closePR,
  findAssociatedPRByIssueNumber,
  findTaskBranch,
  deleteBranch,
  invalidateTaskCache,
  invalidatePRCache,
  invalidateBoardCache,
  invalidateBranchCache,
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { HIDDEN_TASK_LABEL } from "@dashboard/lib/constants";
import { GOAL_LABEL_PREFIX } from "@dashboard/lib/goals";
import { getOwner, getRepo } from "@dashboard/lib/github-client";
import { isProtectedBranch } from "@dashboard/lib/branches";
import { matchWorkflowRunsForTask } from "@dashboard/lib/workflow-matching";
import { withActor, postWithFallback } from "@dashboard/lib/kody-command";
import { startKodyTask } from "@dashboard/lib/tasks/start-task";

const actionSchema = z.object({
  action: z.enum([
    "rerun",
    "execute",
    "abort",
    "close",
    "close-issue",
    "close-pr",
    "reset",
    "reopen",
    "add-label",
    "remove-label",
    "assign",
    "unassign",
    "comment",
    "fix",
    "approve-ui",
    "approve-pr",
    "report-issue",
    "update",
  ]),
  feedback: z.string().optional(),
  fromStage: z.string().optional(),
  mode: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  label: z.string().optional(),
  labels: z.array(z.string()).optional(),
  comment: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  actorLogin: z.string().optional(),
  /** When true (and the PR is a draft) the approve-pr case flips
   *  `draft: false` before posting the review — GitHub rejects
   *  `createReview({event:"APPROVE"})` on draft PRs, so without
   *  this the "Approve" button silently no-ops on drafts. See
   *  issue #129. */
  approveDrafts: z.boolean().optional(),
});

// `withActor` + `postWithFallback` live in @dashboard/lib/kody-command so
// the CTO decision endpoint can reuse the exact same `@kody` post path.

function isDashboardManagedLabel(label: string): boolean {
  return (
    label.startsWith(GOAL_LABEL_PREFIX) ||
    label === HIDDEN_TASK_LABEL ||
    label.startsWith("kody:")
  );
}

function dashboardManagedLabelOptions(label: string): {
  color: string;
  description: string;
} {
  if (label === HIDDEN_TASK_LABEL) {
    return {
      color: "6b7280",
      description: "Hidden from Kody dashboard task list",
    };
  }

  return {
    color: "38bdf8",
    description: `Tasks attached to ${label}`,
  };
}

async function addLabelWithManagedFallback(
  issueNumber: number,
  label: string,
  userOctokit: Awaited<ReturnType<typeof getUserOctokit>>,
): Promise<void> {
  try {
    await addLabels(issueNumber, [label], userOctokit ?? undefined);
  } catch (error) {
    if (!userOctokit || !isDashboardManagedLabel(label)) throw error;

    console.warn(
      "[Kody] addLabels with user token failed; retrying managed label with bot token:",
      error,
    );
    await ensureLabel(label, dashboardManagedLabelOptions(label));
    await addLabels(issueNumber, [label]);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { taskId } = await params;
    const body = await req.json();
    const {
      action,
      feedback,
      mode: _mode,
      actorLogin,
      approveDrafts,
    } = actionSchema.parse(body);

    // Verify actorLogin matches the authenticated session (prevents impersonation)
    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;
    const { identity } = actorResult;

    // Use verified identity's login for attribution
    const actor = identity.login;

    // Get user's Octokit (null for legacy sessions → falls back to bot token)
    const userOctokit = await getUserOctokit(req);

    // Get issue number from taskId
    const issueNumber = parseInt(taskId.replace("issue-", ""), 10);
    if (isNaN(issueNumber)) {
      return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
    }

    const { assignees, label, comment } = actionSchema.parse(body);

    recordAudit(req, {
      action: "task.action",
      resource: `#${issueNumber}`,
      detail: action,
    });

    switch (action) {
      case "rerun": {
        const command = feedback?.trim()
          ? `@kody\n\n${feedback.trim()}`
          : "@kody";
        await postWithFallback(issueNumber, command, actor, userOctokit);
        return NextResponse.json({
          success: true,
          message: "Kody rerun triggered",
        });
      }

      case "execute": {
        const result = await startKodyTask(taskId, actor);
        return NextResponse.json(result);
      }

      case "abort": {
        // Find runs linked to this issue. The dashboard already has a battle-
        // tested matcher in src/dashboard/lib/workflow-matching.ts that's used
        // when deriving columns; reuse it here so the cancel logic uses the
        // exact same task→run mapping as the UI. Comment-scan is a backup for
        // edge cases where the run's display_title doesn't reference the
        // issue but the engine has posted a `[logs](.../actions/runs/N)`
        // comment.
        const issue = await fetchIssue(issueNumber, { noCache: true });
        const issueTitle = issue?.title ?? "";
        const taskIdMatch = issueTitle.match(/\[[^\]]+\]/);
        const titleTaskId = taskIdMatch
          ? taskIdMatch[0].replace(/[\[\]]/g, "")
          : taskId;

        const candidateIds = new Set<number>();

        // Primary: title/branch/issue-number matching against recent kody runs.
        // perPage=100 covers a busy repo's last few hours of activity.
        try {
          const runs = await fetchWorkflowRuns({ perPage: 100 });
          const matched = matchWorkflowRunsForTask(
            runs,
            issueTitle,
            issueNumber,
            titleTaskId,
          );
          for (const r of matched) {
            if (r.status === "in_progress" || r.status === "queued") {
              candidateIds.add(r.id);
            }
          }
        } catch (err) {
          console.warn("[Kody] abort: fetchWorkflowRuns failed:", err);
        }

        // Backup: any [logs](.../actions/runs/N) URLs the engine posted on the
        // issue. Catches cases where matchWorkflowRunsForTask misses (e.g. the
        // run's display_title is the comment body, branch is "main").
        try {
          const comments = await fetchComments(issueNumber);
          const runUrlRegex = /\/actions\/runs\/(\d+)/g;
          for (let i = comments.length - 1; i >= 0; i--) {
            const body = comments[i]?.body ?? "";
            let match: RegExpExecArray | null;
            runUrlRegex.lastIndex = 0;
            while ((match = runUrlRegex.exec(body)) !== null) {
              const id = Number(match[1]);
              if (Number.isFinite(id)) candidateIds.add(id);
            }
            if (candidateIds.size >= 20) break;
          }
        } catch (err) {
          console.warn("[Kody] abort: fetchComments failed:", err);
        }

        const octokit = userOctokit ?? getOctokit();
        let cancelledCount = 0;
        for (const runId of candidateIds) {
          try {
            const { data: runDetail } = await octokit.actions.getWorkflowRun({
              owner: getOwner(),
              repo: getRepo(),
              run_id: runId,
            });
            if (
              runDetail.status === "in_progress" ||
              runDetail.status === "queued"
            ) {
              await cancelWorkflowRun(runId, userOctokit ?? undefined);
              cancelledCount += 1;
            }
          } catch (err) {
            console.warn(
              `[Kody] abort: failed to inspect/cancel run ${runId}:`,
              err,
            );
          }
        }

        invalidateTaskCache();
        invalidateBoardCache();

        if (cancelledCount > 0) {
          return NextResponse.json({
            success: true,
            message: `Stop requested for ${cancelledCount} workflow run${cancelledCount === 1 ? "" : "s"}`,
          });
        }

        // No active run was found, so these are stale lifecycle labels rather
        // than evidence of work that is still winding down.
        const lifecycleLabels = [
          "kody:running",
          "kody:planning",
          "kody:reviewing",
          "kody:reviewing-ui",
          "kody:building",
          "kody:classifying",
          "kody:researching",
          "kody:fixing",
          "kody:fixing-ci",
          "kody:resolving",
          "kody:syncing",
          "kody:orchestrating",
        ];
        let removedLabel = false;
        for (const lbl of lifecycleLabels) {
          try {
            await removeLabel(issueNumber, lbl, userOctokit ?? undefined);
            removedLabel = true;
          } catch {
            // 404 = label wasn't applied; ignore
          }
        }

        if (removedLabel) {
          return NextResponse.json({
            success: true,
            message:
              "Cleared stale running labels (no live workflow run found)",
          });
        }
        return NextResponse.json({
          success: true,
          message: "Nothing to stop (task was not running)",
        });
      }

      case "close": {
        // Close PR if exists
        const pr = await findAssociatedPRByIssueNumber(issueNumber);
        if (pr) {
          await closePR(pr.number, userOctokit ?? undefined);
        }

        // Delete branch if exists
        const branchName = await findTaskBranch(taskId);
        if (branchName && !isProtectedBranch(branchName)) {
          await deleteBranch(branchName, userOctokit ?? undefined);
        }

        // Finally close the issue
        await updateIssue(
          issueNumber,
          { state: "closed" },
          userOctokit ?? undefined,
        );
        if (actor) {
          const closeMsg = userOctokit
            ? "🔒 Issue closed"
            : `🔒 Issue closed _(by @${actor})_`;
          await postComment(issueNumber, closeMsg, userOctokit ?? undefined);
        }

        invalidateTaskCache();
        invalidatePRCache();
        invalidateBranchCache();

        return NextResponse.json({
          success: true,
          message: "Issue closed (PR closed, branch deleted)",
        });
      }

      case "close-issue": {
        const octokit = userOctokit ?? getOctokit();
        const { data: existing } = await octokit.issues.get({
          owner: getOwner(),
          repo: getRepo(),
          issue_number: issueNumber,
        });

        if (existing.pull_request) {
          return NextResponse.json(
            { error: "Backlog item is a pull request, not an issue" },
            { status: 400 },
          );
        }

        if (existing.state === "closed") {
          invalidateTaskCache();
          invalidateBoardCache();
          return NextResponse.json({
            success: true,
            message: "Issue already closed",
          });
        }

        const { data: updated } = await octokit.issues.update({
          owner: getOwner(),
          repo: getRepo(),
          issue_number: issueNumber,
          state: "closed",
        });

        if (updated.state !== "closed") {
          return NextResponse.json(
            {
              error: "github_close_not_confirmed",
              message: "GitHub did not report the issue as closed.",
            },
            { status: 502 },
          );
        }

        if (actor) {
          const closeMsg = userOctokit
            ? "🔒 Issue closed from backlog"
            : `🔒 Issue closed from backlog _(by @${actor})_`;
          await postComment(issueNumber, closeMsg, userOctokit ?? undefined);
        }

        invalidateTaskCache();
        invalidateBoardCache();

        return NextResponse.json({
          success: true,
          message: "Issue closed",
          state: updated.state,
        });
      }

      case "close-pr": {
        const pr = await findAssociatedPRByIssueNumber(issueNumber);
        if (!pr) {
          return NextResponse.json(
            { error: "No associated PR found" },
            { status: 404 },
          );
        }
        await closePR(pr.number, userOctokit ?? undefined);

        // Delete branch if exists (GitHub has no "delete PR" — closing the
        // PR + deleting its branch is the closest thing).
        const branchName = await findTaskBranch(taskId);
        let branchDeleted = false;
        if (branchName && !isProtectedBranch(branchName)) {
          await deleteBranch(branchName, userOctokit ?? undefined);
          branchDeleted = true;
        }

        invalidateTaskCache();
        invalidatePRCache();
        invalidateBranchCache();
        return NextResponse.json({
          success: true,
          message: branchDeleted
            ? `PR #${pr.number} closed and branch deleted`
            : `PR #${pr.number} closed`,
        });
      }

      case "reset": {
        const branchName = await findTaskBranch(taskId);

        // Close PR if exists
        const pr = await findAssociatedPRByIssueNumber(issueNumber);
        if (pr) {
          await closePR(pr.number, userOctokit ?? undefined);
        }

        // Delete branch if exists
        if (branchName && !isProtectedBranch(branchName)) {
          await deleteBranch(branchName, userOctokit ?? undefined);
        }

        // Remove lifecycle labels
        const labelsToRemove = [
          "kody:done",
          "kody:failed",
          "kody:running",
          "kody:planning",
          "kody:reviewing",
          "kody:reviewing-ui",
        ];
        for (const lbl of labelsToRemove) {
          try {
            await removeLabel(issueNumber, lbl, userOctokit ?? undefined);
          } catch {
            // Ignore if label doesn't exist
          }
        }

        // Re-trigger pipeline
        await postWithFallback(
          issueNumber,
          "🔄 Task reset and re-triggered",
          actor,
          userOctokit,
        );
        await postComment(issueNumber, "@kody", userOctokit ?? undefined);

        invalidateTaskCache();
        invalidatePRCache();
        invalidateBranchCache();
        invalidateBoardCache();

        return NextResponse.json({
          success: true,
          message: `Task reset: branch deleted, PR closed, labels removed, pipeline triggered`,
        });
      }

      case "reopen": {
        await updateIssue(
          issueNumber,
          { state: "open" },
          userOctokit ?? undefined,
        );
        if (actor) {
          const reopenMsg = userOctokit
            ? "🔓 Issue reopened"
            : `🔓 Issue reopened _(by @${actor})_`;
          await postComment(issueNumber, reopenMsg, userOctokit ?? undefined);
        }
        invalidateTaskCache();
        return NextResponse.json({ success: true, message: "Issue reopened" });
      }

      case "add-label": {
        if (!label) {
          return NextResponse.json(
            { error: "Label is required" },
            { status: 400 },
          );
        }
        // GitHub's addLabels endpoint 422s on unknown labels — auto-create
        // dashboard-managed labels defensively so first use always succeeds.
        if (
          label.startsWith(GOAL_LABEL_PREFIX) ||
          label === HIDDEN_TASK_LABEL ||
          label.startsWith("kody:")
        ) {
          try {
            await ensureLabel(
              label,
              label === HIDDEN_TASK_LABEL
                ? {
                    color: "6b7280",
                    description: "Hidden from the Kody dashboard task list",
                  }
                : {
                    color: "38bdf8",
                    description: `Tasks attached to ${label}`,
                  },
              userOctokit ?? undefined,
            );
          } catch (labelErr) {
            console.warn("[Kody] ensureLabel failed (continuing):", labelErr);
          }
        }
        await addLabelWithManagedFallback(issueNumber, label, userOctokit);
        return NextResponse.json({
          success: true,
          message: `Label "${label}" added`,
        });
      }

      case "remove-label": {
        if (!label) {
          return NextResponse.json(
            { error: "Label is required" },
            { status: 400 },
          );
        }
        await removeLabel(issueNumber, label, userOctokit ?? undefined);
        return NextResponse.json({
          success: true,
          message: `Label "${label}" removed`,
        });
      }

      case "assign": {
        if (!assignees || assignees.length === 0) {
          return NextResponse.json(
            { error: "Assignees are required" },
            { status: 400 },
          );
        }
        await addAssignees(issueNumber, assignees, userOctokit ?? undefined);
        invalidateTaskCache();
        return NextResponse.json({
          success: true,
          message: `Assigned to ${assignees.join(", ")}`,
        });
      }

      case "unassign": {
        if (!assignees || assignees.length === 0) {
          return NextResponse.json(
            { error: "Assignees are required" },
            { status: 400 },
          );
        }
        await removeAssignees(issueNumber, assignees, userOctokit ?? undefined);
        invalidateTaskCache();
        return NextResponse.json({
          success: true,
          message: `Unassigned ${assignees.join(", ")}`,
        });
      }

      case "comment": {
        if (!comment) {
          return NextResponse.json(
            { error: "Comment is required" },
            { status: 400 },
          );
        }
        await postComment(issueNumber, comment, userOctokit ?? undefined);
        return NextResponse.json({ success: true, message: "Comment posted" });
      }

      case "fix": {
        if (!comment) {
          return NextResponse.json(
            { error: "Fix description is required" },
            { status: 400 },
          );
        }
        const associatedPR = await findAssociatedPRByIssueNumber(issueNumber);
        if (!associatedPR) {
          return NextResponse.json(
            { error: "No associated PR found" },
            { status: 404 },
          );
        }
        const fixMessage = `@kody fix\n\n${comment}`;
        const fixBody = userOctokit ? fixMessage : withActor(fixMessage, actor);
        await postComment(
          associatedPR.number,
          fixBody,
          userOctokit ?? undefined,
        );
        // Clear terminal lifecycle labels and apply kody:fixing so the task
        // moves straight to the "building" column instead of waiting ~10-60s
        // for the engine to dispatch and swap labels. The engine's
        // setLifecycleLabel(kody:fixing) is idempotent (no-op if already
        // present), and the canonical kodyState comment overrides labels once
        // the workflow runs, so a pre-applied label self-heals.
        for (const lbl of ["kody:done", "kody:failed"]) {
          try {
            await removeLabel(issueNumber, lbl, userOctokit ?? undefined);
          } catch {
            // 404 = label wasn't applied; ignore
          }
        }
        try {
          await addLabels(
            issueNumber,
            ["kody:fixing"],
            userOctokit ?? undefined,
          );
        } catch {
          // Non-fatal: engine re-adds kody:fixing when the workflow starts.
        }
        invalidateTaskCache();
        invalidatePRCache();
        return NextResponse.json({
          success: true,
          message: "Fix requested on PR",
        });
      }

      case "approve-ui": {
        await addLabels(issueNumber, ["ui-approved"], userOctokit ?? undefined);
        // Clear any prior QA "needs-fix" flag so approval is the latest signal.
        try {
          await removeLabel(
            issueNumber,
            "kody:needs-fix",
            userOctokit ?? undefined,
          );
        } catch {
          // 404 = label wasn't applied; ignore
        }
        await postWithFallback(
          issueNumber,
          "✅ Preview UI approved",
          actor,
          userOctokit,
        );
        invalidateTaskCache();
        return NextResponse.json({
          success: true,
          message: "Preview UI approved",
        });
      }

      case "report-issue": {
        if (!comment) {
          return NextResponse.json(
            { error: "Issue notes are required" },
            { status: 400 },
          );
        }
        // Auto-create the label defensively — repos that have never used it
        // will 422 on addLabels otherwise.
        try {
          await ensureLabel(
            "kody:needs-fix",
            {
              color: "b91c1c",
              description: "QA flagged unresolved issues on this task",
            },
            userOctokit ?? undefined,
          );
        } catch (labelErr) {
          console.warn(
            "[Kody] ensureLabel kody:needs-fix failed (continuing):",
            labelErr,
          );
        }
        await addLabels(
          issueNumber,
          ["kody:needs-fix"],
          userOctokit ?? undefined,
        );
        // Clear terminal lifecycle labels so the task immediately leaves the
        // "done"/"failed" column. QA reporting an issue means the work isn't
        // actually done — column should reflect that without waiting for the
        // engine to react to the QA comment.
        for (const lbl of ["kody:done", "kody:failed"]) {
          try {
            await removeLabel(issueNumber, lbl, userOctokit ?? undefined);
          } catch {
            // 404 = label wasn't applied; ignore
          }
        }
        const qaBody = `🛑 QA: ${comment}`;
        await postWithFallback(issueNumber, qaBody, actor, userOctokit);
        invalidateTaskCache();
        return NextResponse.json({ success: true, message: "Issue reported" });
      }

      case "approve-pr": {
        const associatedPR = await findAssociatedPRByIssueNumber(issueNumber);
        if (!associatedPR) {
          return NextResponse.json(
            { error: "No associated PR found" },
            { status: 404 },
          );
        }
        // Use user's Octokit for PR review (review appears under user's identity)
        // If user token fails, the PR review fails - but we still try to add labels and comment
        const octokit = userOctokit ?? getOctokit();
        // Issue #129: GitHub rejects `createReview({event:"APPROVE"})` on
        // a draft PR. When the dashboard's "Also approve drafts" toggle is
        // on, flip the PR to ready-for-review FIRST so the review sticks.
        // Skipped entirely when the toggle is off or the PR is already
        // ready — both paths must stay byte-identical to the pre-fix
        // behavior for non-draft PRs.
        if (approveDrafts && associatedPR.isDraft) {
          try {
            await octokit.pulls.update({
              owner: getOwner(),
              repo: getRepo(),
              pull_number: associatedPR.number,
              draft: false,
            });
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn("[Kody] PR ready-for-review note:", msg);
          }
        }
        try {
          await octokit.pulls.createReview({
            owner: getOwner(),
            repo: getRepo(),
            pull_number: associatedPR.number,
            event: "APPROVE",
            body: `✅ PR approved by @${actor} via Kody dashboard.`,
          });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          if (!msg.includes("already approved")) {
            console.warn("[Kody] PR approval note:", msg);
          }
        }
        // For label, try user token first then fallback
        try {
          await addLabels(
            issueNumber,
            ["pr-approved"],
            userOctokit ?? undefined,
          );
        } catch {
          // Fallback to bot token
          try {
            await addLabels(issueNumber, ["pr-approved"]);
          } catch {
            // Ignore label errors
          }
        }
        // For comment, use fallback so it always posts
        await postWithFallback(
          issueNumber,
          "✅ PR approved",
          actor,
          userOctokit,
        );
        invalidateTaskCache();
        invalidatePRCache();
        return NextResponse.json({ success: true, message: "PR approved" });
      }

      case "update": {
        const updates: {
          title?: string;
          body?: string;
          labels?: string[];
          assignees?: string[];
        } = {};
        const parsed = actionSchema.parse(body);
        const { title, body: issueBody, labels, assignees } = parsed;

        if (title) updates.title = title;
        if (issueBody !== undefined) updates.body = issueBody;
        if (labels) updates.labels = labels;
        if (assignees) updates.assignees = assignees;

        if (Object.keys(updates).length === 0) {
          return NextResponse.json(
            { error: "No fields to update" },
            { status: 400 },
          );
        }

        await updateIssue(issueNumber, updates, userOctokit ?? undefined);
        if (actor) {
          const updateMsg = userOctokit
            ? "📝 Issue updated"
            : `📝 Issue updated _(by @${actor})_`;
          await postComment(issueNumber, updateMsg, userOctokit ?? undefined);
        }
        invalidateTaskCache();
        return NextResponse.json({ success: true, message: "Issue updated" });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("[Kody] Error processing action:", error);

    if (error.name === "ZodError") {
      return NextResponse.json(
        { error: "Invalid request", details: error.errors },
        { status: 400 },
      );
    }

    // User's GitHub token expired/revoked — prompt re-auth
    if (error.status === 401) {
      return NextResponse.json(
        {
          error: "github_token_expired",
          message: "Your GitHub token has expired. Please log in again.",
        },
        { status: 401 },
      );
    }
    if (error.status === 403) {
      const msg =
        error?.message || error?.response?.data?.message || "Forbidden";
      const isRateLimit =
        msg.includes("rate limit") ||
        error?.response?.headers?.["x-ratelimit-remaining"] === "0";

      if (isRateLimit) {
        return NextResponse.json(
          { error: "rate_limited", message: "GitHub API rate limit exceeded" },
          { status: 429 },
        );
      }

      return NextResponse.json(
        { error: "github_forbidden", message: `GitHub API: ${msg}` },
        { status: 403 },
      );
    }

    // Validation (422) — e.g. label doesn't exist in repo — surface the
    // GitHub message so the client can show something useful instead of 500.
    if (error?.status === 422) {
      const ghMsg =
        error?.response?.data?.message ||
        error?.message ||
        "GitHub validation failed";
      return NextResponse.json(
        { error: "github_validation_failed", message: ghMsg },
        { status: 422 },
      );
    }
    if (error?.status === 404) {
      return NextResponse.json(
        {
          error: "github_not_found",
          message:
            error?.response?.data?.message || "Resource not found on GitHub",
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "internal_error", message: error?.message || "Internal error" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
