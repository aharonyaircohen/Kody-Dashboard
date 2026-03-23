/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern tasks-api
 * @ai-summary API route to fetch and create tasks (GitHub issues)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKodyAuth, verifyActorLogin, getUserOctokit } from '@dashboard/lib/auth'

import {
  fetchIssues,
  fetchWorkflowRuns,
  fetchOpenPRs,
  fetchDeploymentPreviews,
  findBranchesByIssueNumbers,
  getStatusFromBranch,
  findStatusOnBranch,
  createIssue,
  uploadIssueAttachment,
  postComment,
} from '@dashboard/lib/github-client'
import type {
  KodyTask,
  ColumnId,
  GitHubIssue,
  GitHubPR,
  WorkflowRun,
  KodyPipelineStatus,
} from '@dashboard/lib/types'
import { matchWorkflowRunToTask } from '@dashboard/lib/workflow-matching'

/**
 * Derive column from live pipeline status.
 * Pipeline state is more accurate than GitHub labels (no propagation delay).
 * Called first when pipeline data is available; label-based fallback used otherwise.
 */
function deriveColumnFromPipeline(pipeline: KodyPipelineStatus): ColumnId {
  switch (pipeline.state) {
    case 'running':
      return 'building'
    case 'paused':
      return 'gate-waiting'
    case 'completed':
      return 'review'
    case 'failed':
    case 'timeout':
      return 'failed'
    default:
      return 'building'
  }
}

/**
 * Derive gate type from pipeline controlMode, falling back to label names.
 * Pipeline data is preferred since labels may lag by 10–30 s.
 */
function deriveGateType(
  pipeline?: KodyPipelineStatus | null,
  labelNames?: string[],
): 'hard-stop' | 'risk-gated' | undefined {
  if (pipeline?.controlMode === 'hard-stop') return 'hard-stop'
  if (pipeline?.controlMode === 'risk-gated') return 'risk-gated'
  if (labelNames?.includes('hard-stop')) return 'hard-stop'
  if (labelNames?.includes('risk-gated')) return 'risk-gated'
  return undefined
}

// Map GitHub issue state to column using agent labels, workflow runs, and PR status.
// Used as fallback when no live pipeline data is available.
// Priority: kody:failed/done > gate labels > kody:planning/building > active runs > completed runs > PR > other labels
function getColumnForIssue(
  issue: GitHubIssue,
  workflowRun?: WorkflowRun,
  associatedPR?: GitHubPR | null,
): ColumnId {
  const labelNames = issue.labels.map((l) => l.name.toLowerCase())

  // 0. Terminal lifecycle labels (highest priority)
  if (labelNames.includes('kody:failed')) return 'failed'
  // kody:done = pipeline finished, PR created → task goes to review
  // Task is only truly "done" when the PR is merged and the issue is closed.
  if (labelNames.includes('kody:done') || labelNames.includes('kody:review')) {
    return 'review'
  }

  // 1. Gate labels — pipeline paused waiting for approval.
  // Must be checked BEFORE kody:planning/kody:building and in_progress workflow,
  // because the pipeline keeps running (polling for approval) while gated,
  // and the kody:planning label is never removed when a gate fires.
  if (labelNames.includes('hard-stop') || labelNames.includes('risk-gated')) return 'gate-waiting'

  // 3. Kody active-work labels (only reached when NOT gated)
  if (labelNames.includes('kody:planning') || labelNames.includes('kody:building'))
    return 'building'

  // 4. Active workflow run (only reached when NOT gated and no kody:* label)
  if (workflowRun?.status === 'in_progress') return 'building'

  // 5. Explicit state labels (only checked when no active workflow run)
  if (labelNames.includes('failed')) return 'failed'
  if (labelNames.includes('gate-waiting')) return 'gate-waiting'
  if (labelNames.includes('retrying')) return 'retrying'

  // 6. Workflow run completed status
  if (workflowRun?.status === 'completed') {
    // Also handle timed_out and cancelled as failures
    if (
      workflowRun.conclusion === 'failure' ||
      workflowRun.conclusion === 'timed_out' ||
      workflowRun.conclusion === 'cancelled'
    )
      return 'failed'
  }

  // 7. Associated PR (always fetched via bulk)
  if (associatedPR && !associatedPR.merged_at) return 'review'

  // 8. Other labels
  if (labelNames.includes('released')) return 'done'
  if (labelNames.includes('in-progress') || labelNames.includes('building')) return 'building'
  if (labelNames.includes('review') || labelNames.includes('pr')) return 'review'

  // 9. Default to open
  return 'open'
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const { searchParams } = new URL(req.url)
  const board = searchParams.get('board') || 'all'
  const since = searchParams.get('since') || undefined // ISO date string, e.g., "2026-02-01"
  // includeDetails param is no longer needed — pipeline data is auto-fetched for active tasks

  // Date filter presets
  let sinceDate: string | undefined = since
  if (!sinceDate && searchParams.get('days')) {
    const days = parseInt(searchParams.get('days')!, 10)
    const date = new Date()
    date.setDate(date.getDate() - days)
    sinceDate = date.toISOString()
  }

  try {
    // Fetch issues, workflow runs, and open PRs in parallel (3 API calls, all cached)
    const [issues, workflowRuns, openPRs] = await Promise.all([
      fetchIssues({
        state: 'open',
        perPage: 100,
        since: sinceDate,
      }),
      fetchWorkflowRuns({ perPage: 30 }),
      fetchOpenPRs(),
    ])

    // Workflow runs are matched per-task below using matchWorkflowRunToTask()
    // which prefers active (in_progress/queued) runs over stale completed ones.

    // Build PR lookup: match by title or by issue number in branch name
    const prsByIssueTitle = new Map<string, (typeof openPRs)[number]>()
    const prsByIssueNumber = new Map<number, (typeof openPRs)[number]>()
    for (const pr of openPRs) {
      prsByIssueTitle.set(pr.title, pr)
      // Extract issue number from branch name (e.g., "feat/501-add-loading" -> 501)
      // or from PR title "Closes #501"
      const branchMatch = pr.head.ref.match(/\/(\d{3,})-/)
      if (branchMatch) {
        prsByIssueNumber.set(parseInt(branchMatch[1], 10), pr)
      }
      const closesMatch = pr.title.match(/(?:closes|fixes|resolves)\s+#(\d+)/i)
      if (closesMatch) {
        prsByIssueNumber.set(parseInt(closesMatch[1], 10), pr)
      }
    }

    // Fetch Vercel preview URLs for PRs that have them (1 bulk + N status calls, cached)
    const prShas = openPRs.map((pr) => pr.head.sha)
    const previewUrls = await fetchDeploymentPreviews(prShas)
    // Build SHA -> preview URL lookup keyed by PR number for easy access
    const previewByPrNumber = new Map<number, string>()
    for (const pr of openPRs) {
      const url = previewUrls.get(pr.head.sha)
      if (url) {
        previewByPrNumber.set(pr.number, url)
      }
      // No fallback — showing no preview URL is better than a wrong one.
      // The fetchDeploymentPreviews function now handles SHA-based lookups
      // for older deployments that fall outside the bulk fetch window.
    }

    // First pass: identify all issue numbers that need branch lookup
    // (those with active workflows or pipeline labels)
    const activeIssueNumbers: number[] = []
    for (const issue of issues) {
      const taskIdMatch = issue.title.match(/\[[^\]]+\]/)
      const taskId = taskIdMatch ? taskIdMatch[0].replace(/[\[\]]/g, '') : ''
      const workflowRun = matchWorkflowRunToTask(workflowRuns, issue.title, issue.number, taskId)
      const labelNames = issue.labels.map((l) => l.name.toLowerCase())
      const isLikelyActive =
        workflowRun?.status === 'in_progress' ||
        workflowRun?.status === 'queued' ||
        labelNames.includes('kody:building') ||
        labelNames.includes('kody:planning') ||
        labelNames.includes('kody:failed') ||
        labelNames.includes('hard-stop') ||
        labelNames.includes('risk-gated')

      if (isLikelyActive && issue.number) {
        activeIssueNumbers.push(issue.number)
      }
    }

    // Batch fetch branches for all active issues (5 GitHub API calls max, not 5*N)
    const branchByIssueNumber = await findBranchesByIssueNumbers(activeIssueNumbers)

    // Parse issues into tasks with additional metadata
    const tasks: KodyTask[] = await Promise.all(
      issues.map(async (issue) => {
        // Extract task ID from title (e.g., "[HIGH-507]" or "[260224-auto-38]")
        const taskIdMatch = issue.title.match(/\[[^\]]+\]/)
        const taskId = taskIdMatch ? taskIdMatch[0].replace(/[\[\]]/g, '') : ''

        // Match workflow run — prefers active (in_progress) runs over stale completed ones
        const workflowRun = matchWorkflowRunToTask(workflowRuns, issue.title, issue.number, taskId)

        // Match PR from pre-fetched bulk data (cheap, no extra API calls)
        const pr = prsByIssueTitle.get(issue.title) ?? prsByIssueNumber.get(issue.number) ?? null

        // Fetch pipeline status for tasks with active workflows or pipeline labels.
        // Uses pre-fetched branch map (batch call above) instead of per-task API calls.
        let pipelineStatus = undefined
        const labelNames = issue.labels.map((l) => l.name.toLowerCase())
        const isLikelyActive =
          workflowRun?.status === 'in_progress' ||
          workflowRun?.status === 'queued' ||
          labelNames.includes('kody:building') ||
          labelNames.includes('kody:planning') ||
          labelNames.includes('kody:failed') ||
          labelNames.includes('hard-stop') ||
          labelNames.includes('risk-gated')

        if (isLikelyActive && issue.number) {
          const branch = branchByIssueNumber.get(issue.number)
          if (branch) {
            // First try with known taskId from title brackets (fast, exact path)
            let status: Awaited<ReturnType<typeof getStatusFromBranch>> = null
            if (taskId) {
              status = await getStatusFromBranch(taskId, branch)
            }
            // Fallback: discover task ID by scanning .tasks/ directory on the branch.
            // Pipeline generates random task IDs (e.g., 260306-auto-330) that don't
            // match the issue number, so we need to discover the actual directory.
            if (!status) {
              status = await findStatusOnBranch(branch, issue.number)
            }
            if (status) pipelineStatus = status
          }
        }

        // Column derivation: pipeline status is authoritative when fresh,
        // falling back to label-based derivation.
        const column: ColumnId = pipelineStatus
          ? deriveColumnFromPipeline(pipelineStatus)
          : getColumnForIssue(issue, workflowRun ?? undefined, pr ?? null)

        // Derive gate type: prefer pipeline controlMode, fall back to issue labels
        const gateType = deriveGateType(pipelineStatus, labelNames)

        return {
          id: taskId ? `${taskId}-${issue.number}` : issue.number.toString(),
          issueNumber: issue.number,
          title: issue.title,
          body: issue.body || '',
          state: issue.state,
          labels: issue.labels.map((l) => l.name),
          column,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          pipeline: pipelineStatus,
          workflowRun: workflowRun
            ? {
                id: workflowRun.id,
                status: workflowRun.status,
                conclusion: workflowRun.conclusion,
                created_at: workflowRun.created_at,
                updated_at: workflowRun.updated_at,
                html_url: workflowRun.html_url,
              }
            : undefined,
          associatedPR: pr
            ? {
                id: pr.id,
                number: pr.number,
                title: pr.title,
                state: pr.state,
                head: pr.head,
                merged_at: pr.merged_at,
                html_url: pr.html_url,
              }
            : null,
          assignees: issue.assignees,
          isKodyAssigned: issue.isKodyAssigned,
          previewUrl: pr ? previewByPrNumber.get(pr.number) : undefined,
          // Substatus from labels and workflow run data
          isTimeout: workflowRun?.conclusion === 'timed_out',
          gateType,
        }
      }),
    )

    // Filter by board if needed
    let filteredTasks = tasks
    if (board !== 'all') {
      if (board.startsWith('label:')) {
        const label = board.replace('label:', '')
        filteredTasks = tasks.filter((t) => t.labels.includes(label))
      } else if (board.startsWith('milestone:')) {
        // Would need to filter by milestone - for now just return all
        filteredTasks = tasks
      }
    }

    return NextResponse.json({ tasks: filteredTasks })
  } catch (error: any) {
    console.error('[Kody] Error fetching tasks:', error)

    // Check for rate limiting (403 from GitHub)
    const isRateLimited =
      error?.status === 403 ||
      error?.message?.includes('rate limit') ||
      error?.response?.headers?.['x-ratelimit-remaining'] === '0'

    if (isRateLimited) {
      const resetTime = error?.response?.headers?.['x-ratelimit-reset']
      const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : null
      const retryAfter = resetDate
        ? Math.ceil((resetDate.getTime() - Date.now()) / 1000 / 60)
        : null

      return NextResponse.json(
        {
          error: 'rate_limited',
          message: 'GitHub API rate limit exceeded',
          retryAfter: retryAfter ? `${retryAfter} minutes` : 'unknown',
          resetTime: resetDate?.toISOString() || null,
        },
        { status: 429 },
      )
    }

    // Check for missing token - match both old and new error message formats from getOctokit()
    // Old: "GITHUB_TOKEN not configured"
    // New: "Neither KODY_BOT_TOKEN nor GITHUB_TOKEN is configured"
    // Both contain "TOKEN" and "configured"
    const isNoTokenError =
      error?.message?.includes('TOKEN') &&
      error?.message?.includes('configured') &&
      (error?.message?.includes('GITHUB_TOKEN') || error?.message?.includes('KODY_BOT_TOKEN'))

    if (isNoTokenError) {
      return NextResponse.json(
        {
          error: 'no_token',
          message:
            'GitHub token is not configured. Set KODY_BOT_TOKEN or GITHUB_TOKEN in environment variables.',
        },
        { status: 401 },
      )
    }

    // Return empty state for other errors instead of mock data
    return NextResponse.json({
      tasks: [],
      error: error?.message || 'Failed to fetch tasks',
    })
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  // Zod validation schema for POST body
  const createTaskSchema = z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    attachments: z
      .array(
        z.object({
          name: z.string(),
          content: z.string(),
        }),
      )
      .optional(),
    actorLogin: z.string().optional(),
  })

  try {
    const body = await req.json()

    // Validate with Zod
    const validated = createTaskSchema.parse(body)

    const { title, body: issueBody, labels, assignees, attachments, actorLogin } = validated

    // Verify actorLogin matches the authenticated session (prevents impersonation)
    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult
    const { identity } = actorResult

    // Use verified identity's login for attribution
    const verifiedLogin = identity.login

    // Get user's Octokit (null for legacy sessions → falls back to bot token)
    const userOctokit = await getUserOctokit(req)

    // Create the issue in GitHub — when user token is available, issue appears under their identity
    const actorNote = userOctokit
      ? ''
      : `\n\n---\n_Created by @${verifiedLogin} via Kody dashboard_`
    const issue = await createIssue(
      {
        title,
        body: (issueBody || '') + actorNote,
        labels: labels || [],
        assignees: assignees || [],
      },
      userOctokit ?? undefined,
    )

    console.log('[Kody] Created issue:', issue.number, issue.title)

    // Auto-trigger pipeline by commenting @kody on the issue
    try {
      await postComment(issue.number, '@kody', userOctokit ?? undefined)
      console.log('[Kody] Triggered pipeline for issue:', issue.number)
    } catch (triggerError: any) {
      console.error('[Kody] Failed to trigger pipeline:', triggerError.message)
      // Don't fail the whole request if trigger fails - task was still created
    }

    // Upload attachments if provided
    const uploadedAttachments = []
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      console.log('[Kody] Uploading', attachments.length, 'attachments...')
      for (const attachment of attachments) {
        try {
          const result = await uploadIssueAttachment(
            issue.number,
            {
              name: attachment.name,
              content: attachment.content,
            },
            userOctokit ?? undefined,
          )
          uploadedAttachments.push(result)
          console.log('[Kody] Uploaded attachment:', result.name, result.attachment_url)
        } catch (attachError: any) {
          console.error('[Kody] Failed to upload attachment:', attachError.message)
        }
      }
    }

    return NextResponse.json({
      success: true,
      issue: {
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
      },
      attachments: uploadedAttachments,
    })
  } catch (error: any) {
    console.error('[Kody] Error creating task:', error)

    // Handle ZodError specifically - return 400 for validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      )
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

    return NextResponse.json(
      { error: 'Failed to create task', details: error.message },
      { status: 500 },
    )
  }
}
