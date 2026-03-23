/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern task-detail-api
 * @ai-summary API route to fetch detailed task info
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { requireKodyAuth } from '@dashboard/lib/auth'

import {
  fetchIssue,
  fetchIssues,
  fetchComments,
  findTaskBranch,
  getStatusFromBranch,
  findAssociatedPRByIssueNumber,
  fetchWorkflowRuns,
} from '@dashboard/lib/github-client'
import { parseAllComments } from '@dashboard/lib/task-parser'
import { matchWorkflowRunToTask } from '@dashboard/lib/workflow-matching'
import type {
  KodyTask,
  GitHubIssue,
  GitHubPR,
  ParsedComment,
  WorkflowRun,
  ColumnId,
} from '@dashboard/lib/types'

/**
 * Derive column from issue state + parsed comments + workflow run + PR.
 * Inlined from the deleted board-mapper.ts.
 */
function deriveColumn(
  issue: GitHubIssue,
  comments: ParsedComment[],
  workflowRun?: WorkflowRun,
  associatedPR?: GitHubPR | null,
): ColumnId {
  const sorted = [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  const taskMarker = sorted.find((c) => c.type === 'task-marker')
  const failure = [...sorted]
    .reverse()
    .find((c) => c.type === 'failure' || c.type === 'kody-failed')
  const gate = [...sorted].reverse().find((c) => c.type === 'gate-request')
  const gateApproval = [...sorted].reverse().find((c) => c.type === 'gate-approval')
  const retries = sorted.filter((c) => c.type === 'supervisor-retry')
  const exhausted = [...sorted].reverse().find((c) => c.type === 'supervisor-exhausted')

  if (failure && exhausted) return 'failed'
  if (gate && (!gateApproval || gate.createdAt > gateApproval.createdAt)) return 'gate-waiting'
  if (retries.length > 0 && !exhausted && failure) return 'retrying'
  if (taskMarker && workflowRun?.status === 'in_progress') return 'building'
  if (associatedPR && !associatedPR.merged_at) return 'review'
  if (taskMarker) return 'building'
  return 'open'
}

function buildKodyTask(options: {
  issue: GitHubIssue
  comments: ParsedComment[]
  workflowRun?: WorkflowRun
  associatedPR?: GitHubPR | null
}): KodyTask {
  const { issue, comments, workflowRun, associatedPR } = options
  const taskMarker = comments.find((c) => c.type === 'task-marker')
  const taskId = taskMarker?.taskId || `issue-${issue.number}`
  const column = deriveColumn(issue, comments, workflowRun, associatedPR)

  // Derive substatus fields from parsed comments
  // Gate type and stage from gate-request comments
  const lastGateRequest = [...comments].reverse().find((c) => c.type === 'gate-request')
  const lastGateApproval = [...comments].reverse().find((c) => c.type === 'gate-approval')
  let gateType: 'hard-stop' | 'risk-gated' | undefined
  let gateStage: string | undefined

  if (
    lastGateRequest &&
    (!lastGateApproval || lastGateRequest.createdAt > lastGateApproval.createdAt)
  ) {
    // Determine gate type from comment body: 🚫 Hard Stop vs 🚦 Risk Gate
    gateType = lastGateRequest.body.includes('🚫 Hard Stop') ? 'hard-stop' : 'risk-gated'
    // Extract gate stage from body (e.g., "paused at architect gate")
    const stageMatch = lastGateRequest.body.match(/at (\w+) gate/)
    gateStage = stageMatch?.[1]
  }

  // Check for other comment-based substates
  const hasClarifyStop = comments.some((c) => c.type === 'clarify-stop')
  const hasExhausted = comments.some((c) => c.type === 'supervisor-exhausted')
  const hasSupervisorError = comments.some((c) => c.type === 'supervisor-error')
  const hasTimeout = comments.some((c) => c.type === 'timeout')

  // Also check workflow run for timeout (GitHub Actions conclusion)
  const isTimeoutFromWorkflow = workflowRun?.conclusion === 'timed_out'

  return {
    id: taskId,
    issueNumber: issue.number,
    title: issue.title,
    body: issue.body || '',
    state: issue.state,
    labels: issue.labels.map((l) => l.name),
    column,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    workflowRun,
    associatedPR,
    // Substatus fields
    gateType,
    gateStage,
    clarifyWaiting: hasClarifyStop && column !== 'done',
    isTimeout: hasTimeout || isTimeoutFromWorkflow,
    isExhausted: hasExhausted,
    isSupervisorError: hasSupervisorError,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  try {
    const { taskId } = await params

    // Try to find by issue number first (optimized path - single API call)
    const issueNumberFromUrl = parseInt(taskId.replace('issue-', ''), 10)

    if (!isNaN(issueNumberFromUrl)) {
      // Optimized: directly fetch the single issue by number
      const issue = await fetchIssue(issueNumberFromUrl)

      if (issue) {
        // Fetch comments for this single issue
        const comments = await fetchComments(issue.number)
        const parsed = parseAllComments(comments)

        // Get workflow runs, branch, and PR in parallel
        const [runs, branch, associatedPR] = await Promise.all([
          fetchWorkflowRuns({ perPage: 50 }),
          findTaskBranch(taskId),
          findAssociatedPRByIssueNumber(issueNumberFromUrl),
        ])

        const workflowRun = matchWorkflowRunToTask(runs, issue.title, issueNumberFromUrl, taskId)

        let pipeline = null
        if (branch) {
          pipeline = await getStatusFromBranch(taskId, branch)
        }

        const task = buildKodyTask({
          issue,
          comments: parsed,
          workflowRun,
          associatedPR,
        })

        if (pipeline) {
          task.pipeline = pipeline
        }

        return NextResponse.json({
          task,
          assignees: issue.assignees,
          comments: comments.map((c) => ({
            id: c.id,
            body: c.body,
            created_at: c.created_at,
            user: c.user,
          })),
        })
      }

      // Issue not found
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Fallback: Search through all issues if taskId is not numeric (e.g., task ID like "260221-feature")
    // Optimized: Fetch all issues AND their comments in parallel batches to reduce N+1
    const issues = await fetchIssues({ state: 'all', perPage: 100 })

    // Fetch comments for all issues in parallel (max 10 concurrent to avoid rate limits)
    const BATCH_SIZE = 10
    const issueComments: Map<number, Awaited<ReturnType<typeof fetchComments>>> = new Map()

    for (let i = 0; i < issues.length; i += BATCH_SIZE) {
      const batch = issues.slice(i, i + BATCH_SIZE)
      const results = await Promise.all(
        batch.map((issue) => fetchComments(issue.number).catch(() => [])),
      )
      batch.forEach((issue, idx) => {
        issueComments.set(issue.number, results[idx])
      })
    }

    // Find the issue that has this task ID in comments
    for (const issue of issues) {
      const comments = issueComments.get(issue.number) || []
      const parsed = parseAllComments(comments)
      const taskMarker = parsed.find((c) => c.type === 'task-marker')

      if (taskMarker?.taskId === taskId) {
        // Get workflow runs, branch, and PR in parallel
        const [runs, branch, associatedPR] = await Promise.all([
          fetchWorkflowRuns({ perPage: 50 }),
          findTaskBranch(taskId),
          findAssociatedPRByIssueNumber(issue.number),
        ])

        const workflowRun = matchWorkflowRunToTask(runs, issue.title, issue.number, taskId)

        // Get pipeline status
        let pipeline = null
        if (branch) {
          pipeline = await getStatusFromBranch(taskId, branch)
        }

        // Build task
        const task = buildKodyTask({
          issue,
          comments: parsed,
          workflowRun,
          associatedPR,
        })

        if (pipeline) {
          task.pipeline = pipeline
        }

        // Return task with assignees and raw comments for the detail panel
        return NextResponse.json({
          task,
          assignees: issue.assignees,
          comments: comments.map((c) => ({
            id: c.id,
            body: c.body,
            created_at: c.created_at,
            user: c.user,
          })),
        })
      }
    }

    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  } catch (error: any) {
    console.error('[Kody] Error fetching task detail:', error)

    if (error.status === 401) {
      return NextResponse.json({ error: 'GitHub token expired' }, { status: 502 })
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
