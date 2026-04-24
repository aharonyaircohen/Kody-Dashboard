/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goals-api
 * @ai-summary Goal detail API — PATCH updates goal metadata; DELETE removes the
 *   goal from the manifest. Backed by a single manifest issue.
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
  })
  if (!issues.length) return { manifest: { version: 1, goals: [] }, issueNumber: null }
  const first = [...issues].sort((a, b) => a.number - b.number)[0]
  const full = await fetchIssue(first.number)
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

const patchGoalSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  actorLogin: z.string().optional(),
})

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

    const { manifest, issueNumber } = await readManifest()
    if (!issueNumber) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const index = manifest.goals.findIndex((g) => g.id === id)
    if (index === -1) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const current = manifest.goals[index]
    const updated: Goal = {
      ...current,
      name: patch.name?.trim() ?? current.name,
      description:
        patch.description === null
          ? undefined
          : patch.description === undefined
            ? current.description
            : patch.description.trim() || undefined,
      dueDate:
        patch.dueDate === null
          ? undefined
          : patch.dueDate === undefined
            ? current.dueDate
            : patch.dueDate.trim() || undefined,
      updatedAt: new Date().toISOString(),
    }

    const nextGoals = [...manifest.goals]
    nextGoals[index] = updated
    const nextManifest: GoalsManifest = { version: 1, goals: nextGoals }

    const userOctokit = await getUserOctokit(req)
    await updateIssue(
      issueNumber,
      { body: serializeManifestBody(nextManifest) },
      userOctokit ?? undefined,
    )

    return NextResponse.json({ goal: updated })
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

    const { manifest, issueNumber } = await readManifest()
    if (!issueNumber) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const nextGoals = manifest.goals.filter((g) => g.id !== id)
    if (nextGoals.length === manifest.goals.length) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const userOctokit = await getUserOctokit(req)
    const nextManifest: GoalsManifest = { version: 1, goals: nextGoals }
    await updateIssue(
      issueNumber,
      { body: serializeManifestBody(nextManifest) },
      userOctokit ?? undefined,
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Goals] Error deleting goal:', error)
    return mapGithubError(error, 'delete_failed')
  } finally {
    clearGitHubContext()
  }
}
