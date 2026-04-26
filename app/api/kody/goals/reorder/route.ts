/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goals-api
 * @ai-summary Reorder goals — POST accepts an ordered list of goal IDs and
 *   rewrites the manifest with goals in that order. Goals not present in the
 *   payload are appended at the end (preserving their existing relative order).
 *   Goes through `mutateGoalsManifest` so concurrent goal mutations can't
 *   silently overwrite each other (per-instance mutex + verify-after-write).
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
} from '@dashboard/lib/github-client'
import { type Goal, type GoalsManifest } from '@dashboard/lib/goals'
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

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
  actorLogin: z.string().optional(),
})

type ReorderOutcome =
  | { ok: true; goals: Goal[] }
  | { ok: false; reason: 'not_found' }

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const payload = await req.json()
    const parsed = reorderSchema.parse(payload)

    const actorResult = await verifyActorLogin(req, parsed.actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)

    const outcome = await mutateGoalsManifest<ReorderOutcome>(
      (current) => {
        if (current.goals.length === 0) {
          return { kind: 'noop' as const, result: { ok: false, reason: 'not_found' } as const }
        }

        const byId = new Map(current.goals.map((g) => [g.id, g]))
        const ordered: Goal[] = []
        const seen = new Set<string>()
        for (const id of parsed.orderedIds) {
          const goal = byId.get(id)
          if (goal && !seen.has(id)) {
            ordered.push(goal)
            seen.add(id)
          }
        }
        // Append any goals missing from the payload (keeps their original order).
        for (const goal of current.goals) {
          if (!seen.has(goal.id)) ordered.push(goal)
        }
        const next: GoalsManifest = { version: 1, goals: ordered }
        return { next, result: { ok: true, goals: ordered } }
      },
      { userOctokit: userOctokit ?? undefined },
    )

    const result =
      'kind' in outcome ? outcome.result : (outcome.result as ReorderOutcome)
    if (!result.ok) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({ goals: result.goals })
  } catch (error: any) {
    console.error('[Goals] Error reordering goals:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'validation_error', details: error.issues },
        { status: 400 },
      )
    }
    return mapGithubError(error, 'reorder_failed')
  } finally {
    clearGitHubContext()
  }
}
