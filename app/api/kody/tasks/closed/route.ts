/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern closed-tasks-api
 * @ai-summary Returns closed GitHub issues filtered by a goal label. Lightweight
 *   shape (no pipeline derivation, no workflow run matching) — closed tasks are
 *   terminal by definition, so the heavy work in /api/kody/tasks isn't needed.
 *   Fetched on-demand from the goal section's "Show closed" toggle to keep the
 *   main polling cheap.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  requireKodyAuth,
  getRequestAuth,
} from '@dashboard/lib/auth'
import {
  fetchIssues,
  setGitHubContext,
  clearGitHubContext,
} from '@dashboard/lib/github-client'
import type { KodyTask } from '@dashboard/lib/types'
import { GOAL_LABEL_PREFIX } from '@dashboard/lib/goals'
import { parseKodyPhase, parseKodyFlow, TASK_ID_REGEX } from '@dashboard/lib/constants'

function extractTaskId(title: string): string {
  const m = title.match(/^\[([^\]]+)\]/)
  if (!m) return ''
  const candidate = m[1]
  return TASK_ID_REGEX.test(candidate) ? candidate : ''
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)
  }

  try {
    const { searchParams } = new URL(req.url)
    const goalId = searchParams.get('goal')
    if (!goalId) {
      return NextResponse.json(
        { error: 'missing_goal', message: 'goal query param is required' },
        { status: 400 },
      )
    }

    const label = `${GOAL_LABEL_PREFIX}${goalId}`
    const issues = await fetchIssues({
      state: 'closed',
      labels: label,
      perPage: 50,
      // Slightly longer TTL than open tasks — closed list churns rarely.
      ttl: 60_000,
    })

    const tasks: KodyTask[] = issues.map((issue) => {
      const labels = issue.labels.map((l) => l.name)
      const taskId = extractTaskId(issue.title)
      return {
        id: taskId || `issue-${issue.number}`,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        state: 'closed',
        labels,
        column: 'done',
        kodyPhase: parseKodyPhase(labels),
        kodyFlow: parseKodyFlow(labels),
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        assignees: issue.assignees,
        isKodyAssigned: issue.isKodyAssigned,
      }
    })

    return NextResponse.json({ tasks })
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string }
    console.error('[Kody] Error fetching closed tasks:', err)
    if (err?.status === 403 || err?.message?.includes('rate limit')) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'GitHub API rate limit exceeded' },
        { status: 429 },
      )
    }
    return NextResponse.json(
      { error: 'fetch_failed', message: err?.message ?? 'unknown' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}
