/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern task-actions-api
 * @ai-summary API route for task actions (approve, reject, rerun, abort, execute)
 *   Uses per-user GitHub token when available for proper attribution.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKodyAuth, verifyActorLogin, getUserOctokit } from '@dashboard/lib/auth'

import {
  postComment,
  triggerWorkflow,
  cancelWorkflowRun,
  fetchWorkflowRuns,
  updateIssue,
  addAssignees,
  removeAssignees,
  addLabels,
  removeLabel,
  closePR,
  findAssociatedPRByIssueNumber,
  findTaskBranch,
  deleteBranch,
  invalidateTaskCache,
  invalidatePRCache,
  invalidateBoardCache,
  invalidateBranchCache,
  getOctokit,
} from '@dashboard/lib/github-client'
import { GITHUB_OWNER, GITHUB_REPO } from '@dashboard/lib/constants'

const actionSchema = z.object({
  action: z.enum([
    'approve',
    'reject',
    'rerun',
    'execute',
    'abort',
    'close',
    'close-pr',
    'reset',
    'reopen',
    'add-label',
    'remove-label',
    'assign',
    'unassign',
    'comment',
    'fix',
    'approve-ui',
    'approve-pr',
    'update',
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
})

/**
 * Format a string with actor attribution (only used when falling back to bot token).
 * When user's own token is available, comments appear under their identity naturally.
 */
function withActor(message: string, actor?: string): string {
  return actor ? `${message} _(by @${actor})_` : message
}

/**
 * Post a comment with fallback to bot token if user token fails.
 * - First tries with user's Octokit (clean attribution)
 * - If 401/403 (token expired/revoked), falls back to bot token with actor attribution
 * - If no user token, uses bot token with attribution directly
 */
async function postWithFallback(
  issueNumber: number,
  message: string,
  actor: string | undefined,
  userOctokit: any,
): Promise<void> {
  // If no user token, use bot with attribution
  if (!userOctokit) {
    const body = withActor(message, actor)
    await postComment(issueNumber, body)
    return
  }

  // Try with user's token first
  try {
    await postComment(issueNumber, message, userOctokit)
  } catch (error: any) {
    // Check if it's an auth-related error (401 or 403 from GitHub)
    const isAuthError = error?.status === 401 || error?.status === 403
    const isGitHubAuthError =
      isAuthError &&
      (error?.message?.includes('Bad credentials') ||
        error?.message?.includes('Resource not found') ||
        error?.message?.includes('Not Found') ||
        error?.response?.data?.message?.includes('Bad credentials') ||
        error?.response?.data?.message?.includes('Not Found'))

    if (isAuthError || isGitHubAuthError) {
      // User token failed — fall back to bot token with attribution
      console.warn(
        `[Kody] User token failed (status: ${error?.status}), falling back to bot token for issue ${issueNumber}`,
      )
      const body = withActor(message, actor)
      await postComment(issueNumber, body)
    } else {
      // Re-throw non-auth errors
      throw error
    }
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  try {
    const { taskId } = await params
    const body = await req.json()
    const { action, feedback, fromStage, mode: _mode, actorLogin } = actionSchema.parse(body)

    // Verify actorLogin matches the authenticated session (prevents impersonation)
    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult
    const { identity } = actorResult

    // Use verified identity's login for attribution
    const actor = identity.login

    // Get user's Octokit (null for legacy sessions → falls back to bot token)
    const userOctokit = await getUserOctokit(req)

    // Get issue number from taskId
    const issueNumber = parseInt(taskId.replace('issue-', ''), 10)
    if (isNaN(issueNumber)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const { assignees, label, comment } = actionSchema.parse(body)

    switch (action) {
      case 'approve': {
        await postWithFallback(issueNumber, '/kody approve', actor, userOctokit)
        return NextResponse.json({ success: true, message: 'Gate approved' })
      }

      case 'reject': {
        await postWithFallback(issueNumber, '/kody reject', actor, userOctokit)
        return NextResponse.json({ success: true, message: 'Gate rejected' })
      }

      case 'rerun': {
        await triggerWorkflow(
          {
            taskId,
            mode: 'rerun',
            fromStage,
            feedback,
          },
          userOctokit ?? undefined,
        )
        return NextResponse.json({ success: true, message: 'Workflow triggered' })
      }

      case 'execute': {
        await postWithFallback(issueNumber, '/kody', actor, userOctokit)
        return NextResponse.json({ success: true, message: 'Kody execution triggered' })
      }

      case 'abort': {
        // Try to find and cancel in-progress workflow runs for this task
        const runs = await fetchWorkflowRuns({ perPage: 30 })
        const run = runs.find(
          (r) =>
            r.status === 'in_progress' &&
            (r.display_title?.includes(taskId) ||
              r.html_url.includes(taskId) ||
              r.html_url.includes(issueNumber.toString())),
        )

        // Post comment regardless of whether we found a running workflow
        await postWithFallback(
          issueNumber,
          '## 🛑 Operation stopped - Run aborted by user.',
          actor,
          userOctokit,
        )

        if (run) {
          await cancelWorkflowRun(run.id, userOctokit ?? undefined)
          return NextResponse.json({ success: true, message: 'Workflow cancelled' })
        }
        return NextResponse.json({
          success: true,
          message: 'Marked as stopped (no running workflow)',
        })
      }

      case 'close': {
        // Close PR if exists
        const pr = await findAssociatedPRByIssueNumber(issueNumber)
        if (pr) {
          await closePR(pr.number, userOctokit ?? undefined)
        }

        // Delete branch if exists
        const branchName = await findTaskBranch(taskId)
        if (
          branchName &&
          branchName !== 'dev' &&
          branchName !== 'main' &&
          branchName !== 'master'
        ) {
          await deleteBranch(branchName, userOctokit ?? undefined)
        }

        // Finally close the issue
        await updateIssue(issueNumber, { state: 'closed' }, userOctokit ?? undefined)
        if (actor) {
          const closeMsg = userOctokit ? '🔒 Issue closed' : `🔒 Issue closed _(by @${actor})_`
          await postComment(issueNumber, closeMsg, userOctokit ?? undefined)
        }

        invalidateTaskCache()
        invalidatePRCache()
        invalidateBranchCache()

        return NextResponse.json({
          success: true,
          message: 'Issue closed (PR closed, branch deleted)',
        })
      }

      case 'close-pr': {
        const pr = await findAssociatedPRByIssueNumber(issueNumber)
        if (!pr) {
          return NextResponse.json({ error: 'No associated PR found' }, { status: 404 })
        }
        await closePR(pr.number, userOctokit ?? undefined)
        invalidateTaskCache()
        invalidatePRCache()
        return NextResponse.json({ success: true, message: `PR #${pr.number} closed` })
      }

      case 'reset': {
        const branchName = await findTaskBranch(taskId)

        // Close PR if exists
        const pr = await findAssociatedPRByIssueNumber(issueNumber)
        if (pr) {
          await closePR(pr.number, userOctokit ?? undefined)
        }

        // Delete branch if exists
        if (
          branchName &&
          branchName !== 'dev' &&
          branchName !== 'main' &&
          branchName !== 'master'
        ) {
          await deleteBranch(branchName, userOctokit ?? undefined)
        }

        // Remove lifecycle labels
        const labelsToRemove = [
          'kody:done',
          'kody:failed',
          'kody:building',
          'kody:planning',
          'kody:review',
          'hard-stop',
          'risk-gated',
        ]
        for (const lbl of labelsToRemove) {
          try {
            await removeLabel(issueNumber, lbl, userOctokit ?? undefined)
          } catch {
            // Ignore if label doesn't exist
          }
        }

        // Re-trigger pipeline
        await postWithFallback(issueNumber, '🔄 Task reset and re-triggered', actor, userOctokit)
        await postComment(issueNumber, '/kody', userOctokit ?? undefined)

        invalidateTaskCache()
        invalidatePRCache()
        invalidateBranchCache()
        invalidateBoardCache()

        return NextResponse.json({
          success: true,
          message: `Task reset: branch deleted, PR closed, labels removed, pipeline triggered`,
        })
      }

      case 'reopen': {
        await updateIssue(issueNumber, { state: 'open' }, userOctokit ?? undefined)
        if (actor) {
          const reopenMsg = userOctokit ? '🔓 Issue reopened' : `🔓 Issue reopened _(by @${actor})_`
          await postComment(issueNumber, reopenMsg, userOctokit ?? undefined)
        }
        invalidateTaskCache()
        return NextResponse.json({ success: true, message: 'Issue reopened' })
      }

      case 'add-label': {
        if (!label) {
          return NextResponse.json({ error: 'Label is required' }, { status: 400 })
        }
        await addLabels(issueNumber, [label], userOctokit ?? undefined)
        return NextResponse.json({ success: true, message: `Label "${label}" added` })
      }

      case 'remove-label': {
        if (!label) {
          return NextResponse.json({ error: 'Label is required' }, { status: 400 })
        }
        await removeLabel(issueNumber, label, userOctokit ?? undefined)
        return NextResponse.json({ success: true, message: `Label "${label}" removed` })
      }

      case 'assign': {
        if (!assignees || assignees.length === 0) {
          return NextResponse.json({ error: 'Assignees are required' }, { status: 400 })
        }
        await addAssignees(issueNumber, assignees, userOctokit ?? undefined)
        invalidateTaskCache()
        return NextResponse.json({ success: true, message: `Assigned to ${assignees.join(', ')}` })
      }

      case 'unassign': {
        if (!assignees || assignees.length === 0) {
          return NextResponse.json({ error: 'Assignees are required' }, { status: 400 })
        }
        await removeAssignees(issueNumber, assignees, userOctokit ?? undefined)
        invalidateTaskCache()
        return NextResponse.json({ success: true, message: `Unassigned ${assignees.join(', ')}` })
      }

      case 'comment': {
        if (!comment) {
          return NextResponse.json({ error: 'Comment is required' }, { status: 400 })
        }
        await postComment(issueNumber, comment, userOctokit ?? undefined)
        return NextResponse.json({ success: true, message: 'Comment posted' })
      }

      case 'fix': {
        if (!comment) {
          return NextResponse.json({ error: 'Fix description is required' }, { status: 400 })
        }
        const associatedPR = await findAssociatedPRByIssueNumber(issueNumber)
        if (!associatedPR) {
          return NextResponse.json({ error: 'No associated PR found' }, { status: 404 })
        }
        const fixMessage = `@kody fix\n\n${comment}`
        const fixBody = userOctokit ? fixMessage : withActor(fixMessage, actor)
        await postComment(associatedPR.number, fixBody, userOctokit ?? undefined)
        invalidateTaskCache()
        invalidatePRCache()
        return NextResponse.json({ success: true, message: 'Fix requested on PR' })
      }

      case 'approve-ui': {
        await addLabels(issueNumber, ['ui-approved'], userOctokit ?? undefined)
        await postWithFallback(issueNumber, '✅ Preview UI approved', actor, userOctokit)
        invalidateTaskCache()
        return NextResponse.json({ success: true, message: 'Preview UI approved' })
      }

      case 'approve-pr': {
        const associatedPR = await findAssociatedPRByIssueNumber(issueNumber)
        if (!associatedPR) {
          return NextResponse.json({ error: 'No associated PR found' }, { status: 404 })
        }
        // Use user's Octokit for PR review (review appears under user's identity)
        // If user token fails, the PR review fails - but we still try to add labels and comment
        const octokit = userOctokit ?? getOctokit()
        try {
          await octokit.pulls.createReview({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            pull_number: associatedPR.number,
            event: 'APPROVE',
            body: `✅ PR approved by @${actor} via Kody dashboard.`,
          })
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error)
          if (!msg.includes('already approved')) {
            console.warn('[Kody] PR approval note:', msg)
          }
        }
        // For label, try user token first then fallback
        try {
          await addLabels(issueNumber, ['pr-approved'], userOctokit ?? undefined)
        } catch {
          // Fallback to bot token
          try {
            await addLabels(issueNumber, ['pr-approved'])
          } catch {
            // Ignore label errors
          }
        }
        // For comment, use fallback so it always posts
        await postWithFallback(issueNumber, '✅ PR approved', actor, userOctokit)
        invalidateTaskCache()
        invalidatePRCache()
        return NextResponse.json({ success: true, message: 'PR approved' })
      }

      case 'update': {
        const updates: { title?: string; body?: string; labels?: string[]; assignees?: string[] } =
          {}
        const parsed = actionSchema.parse(body)
        const { title, body: issueBody, labels, assignees } = parsed

        if (title) updates.title = title
        if (issueBody !== undefined) updates.body = issueBody
        if (labels) updates.labels = labels
        if (assignees) updates.assignees = assignees

        if (Object.keys(updates).length === 0) {
          return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
        }

        await updateIssue(issueNumber, updates, userOctokit ?? undefined)
        if (actor) {
          const updateMsg = userOctokit ? '📝 Issue updated' : `📝 Issue updated _(by @${actor})_`
          await postComment(issueNumber, updateMsg, userOctokit ?? undefined)
        }
        invalidateTaskCache()
        return NextResponse.json({ success: true, message: 'Issue updated' })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[Kody] Error processing action:', error)

    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 })
    }

    // User's GitHub token expired/revoked — prompt re-auth
    if (error.status === 401) {
      return NextResponse.json(
        {
          error: 'github_token_expired',
          message: 'Your GitHub token has expired. Please log in again.',
        },
        { status: 401 },
      )
    }
    if (error.status === 403) {
      const msg = error?.message || error?.response?.data?.message || 'Forbidden'
      const isRateLimit =
        msg.includes('rate limit') || error?.response?.headers?.['x-ratelimit-remaining'] === '0'

      if (isRateLimit) {
        return NextResponse.json(
          { error: 'rate_limited', message: 'GitHub API rate limit exceeded' },
          { status: 429 },
        )
      }

      return NextResponse.json(
        { error: 'github_forbidden', message: `GitHub API: ${msg}` },
        { status: 403 },
      )
    }

    return NextResponse.json(
      { error: 'internal_error', message: error?.message || 'Internal error' },
      { status: 500 },
    )
  }
}
