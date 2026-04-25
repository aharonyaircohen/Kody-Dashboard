/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goals-api
 * @ai-summary Reorder goals — POST accepts an ordered list of goal IDs and
 *   rewrites the manifest with goals in that order. Goals not present in the
 *   payload are appended at the end (preserving their existing relative order).
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
  fetchIssues,
  fetchIssue,
  updateIssue,
  invalidateIssueCache,
  setGitHubContext,
  clearGitHubContext,
} from '@dashboard/lib/github-client'
import {
  GOALS_MANIFEST_LABEL,
  parseManifestBody,
  serializeManifestBody,
  type Goal,
  type GoalsManifest,
} from '@dashboard/lib/goals'

async function readManifest(): Promise<{
  manifest: GoalsManifest
  issueNumber: number | null
}> {
  const issues = await fetchIssues({
    state: 'open',
    labels: GOALS_MANIFEST_LABEL,
    perPage: 5,
    ttl: 15_000,
  })
  if (!issues.length) return { manifest: { version: 1, goals: [] }, issueNumber: null }
  const first = [...issues].sort((a, b) => a.number - b.number)[0]
  const full = await fetchIssue(first.number, { ttl: 15_000 })
  return {
    manifest: parseManifestBody(full?.body ?? ''),
    issueNumber: first.number,
  }
}

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

    const { manifest, issueNumber } = await readManifest()
    if (!issueNumber) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const byId = new Map(manifest.goals.map((g) => [g.id, g]))
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
    for (const goal of manifest.goals) {
      if (!seen.has(goal.id)) ordered.push(goal)
    }

    const nextManifest: GoalsManifest = { version: 1, goals: ordered }
    const userOctokit = await getUserOctokit(req)
    await updateIssue(
      issueNumber,
      { body: serializeManifestBody(nextManifest) },
      userOctokit ?? undefined,
    )
    invalidateIssueCache(issueNumber)

    return NextResponse.json({ goals: ordered })
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
