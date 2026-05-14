/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goals-api
 * @ai-summary Goal detail API — PATCH updates goal metadata; DELETE removes the
 *   goal from the manifest. Backed by a single manifest issue. Writes go
 *   through `mutateGoalsManifest` so concurrent goal mutations can't silently
 *   overwrite each other (per-instance mutex + verify-after-write retry).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from '@dashboard/lib/auth'
import {
  setGitHubContext,
  clearGitHubContext,
  updateGoalDiscussion,
  closeGoalDiscussion,
} from '@dashboard/lib/github-client'
import {
  type Goal,
  type GoalsManifest,
  goalDiscussionSeedBody,
} from '@dashboard/lib/goals'
import { mutateGoalsManifest } from '@dashboard/lib/goals-server'

function mapGithubError(error: any, fallback: string, status = 500) {
  if (error?.status === 401) {
    return NextResponse.json({ error: 'github_token_expired' }, { status: 401 })
  }
  if (error?.status === 403 || error?.message?.includes('rate limit')) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'GitHub API rate limit exceeded' },
      { status: 429 },
    )
  }
  return NextResponse.json(
    { error: fallback, message: error?.message ?? fallback },
    { status },
  )
}

const patchGoalSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  assignee: z.string().max(120).optional().nullable(),
  actorLogin: z.string().optional(),
})

type PatchOutcome =
  | { ok: true; goal: Goal }
  | { ok: false; reason: 'not_found' }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { id } = await params
    const payload = await req.json()
    const patch = patchGoalSchema.parse(payload)

    const actorResult = await verifyActorLogin(req, patch.actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)

    const outcome = await mutateGoalsManifest<PatchOutcome>(
      (current) => {
        const index = current.goals.findIndex((g) => g.id === id)
        if (index === -1) {
          return { kind: 'noop' as const, result: { ok: false, reason: 'not_found' } as const }
        }
        const cur = current.goals[index]
        const updated: Goal = {
          ...cur,
          name: patch.name?.trim() ?? cur.name,
          description:
            patch.description === null
              ? undefined
              : patch.description === undefined
                ? cur.description
                : patch.description.trim() || undefined,
          dueDate:
            patch.dueDate === null
              ? undefined
              : patch.dueDate === undefined
                ? cur.dueDate
                : patch.dueDate.trim() || undefined,
          assignee:
            patch.assignee === null
              ? undefined
              : patch.assignee === undefined
                ? cur.assignee
                : patch.assignee.trim() || undefined,
          updatedAt: new Date().toISOString(),
        }
        const nextGoals = [...current.goals]
        nextGoals[index] = updated
        const next: GoalsManifest = { version: 1, goals: nextGoals }
        return { next, result: { ok: true, goal: updated } }
      },
      { userOctokit: userOctokit ?? undefined },
    )

    const result =
      'kind' in outcome ? outcome.result : (outcome.result as PatchOutcome)
    if (!result.ok) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    // Mirror name/description/dueDate changes into the backing discussion if
    // one exists. Failures are non-fatal — the goal is already updated and
    // the next visit can resync via lazy-create / manual edit.
    if (result.goal.discussionId) {
      try {
        await updateGoalDiscussion(
          {
            discussionId: result.goal.discussionId,
            title: `Goal: ${result.goal.name}`,
            body: goalDiscussionSeedBody({
              name: result.goal.name,
              description: result.goal.description,
              dueDate: result.goal.dueDate,
            }),
          },
          userOctokit ?? undefined,
        )
      } catch (discErr) {
        console.warn('[Goals] updateGoalDiscussion failed (non-fatal):', discErr)
      }
    }
    return NextResponse.json({ goal: result.goal })
  } catch (error: any) {
    console.error('[Goals] Error updating goal:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'validation_error', details: error.issues },
        { status: 400 },
      )
    }
    return mapGithubError(error, 'update_failed')
  } finally {
    clearGitHubContext()
  }
}

type DeleteOutcome =
  | { ok: true; discussionId?: string }
  | { ok: false; reason: 'not_found' }

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const actorLogin = searchParams.get('actorLogin') ?? undefined

    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)

    const outcome = await mutateGoalsManifest<DeleteOutcome>(
      (current) => {
        const removed = current.goals.find((g) => g.id === id)
        const nextGoals = current.goals.filter((g) => g.id !== id)
        if (nextGoals.length === current.goals.length) {
          return { kind: 'noop' as const, result: { ok: false, reason: 'not_found' } as const }
        }
        const next: GoalsManifest = { version: 1, goals: nextGoals }
        return {
          next,
          result: { ok: true, discussionId: removed?.discussionId },
        }
      },
      { userOctokit: userOctokit ?? undefined },
    )

    const result =
      'kind' in outcome ? outcome.result : (outcome.result as DeleteOutcome)
    if (!result.ok) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    // Close the backing discussion to preserve history (never delete).
    if (result.discussionId) {
      try {
        await closeGoalDiscussion(result.discussionId, userOctokit ?? undefined)
      } catch (discErr) {
        console.warn('[Goals] closeGoalDiscussion failed (non-fatal):', discErr)
      }
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Goals] Error deleting goal:', error)
    return mapGithubError(error, 'delete_failed')
  } finally {
    clearGitHubContext()
  }
}
