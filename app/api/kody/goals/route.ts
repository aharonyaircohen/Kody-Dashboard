/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goals-api
 * @ai-summary Goals API — GET lists goals from the manifest issue; POST creates
 *   a goal (creating the manifest issue on first use). Goals are JSON entries
 *   inside a single GitHub issue labelled `kody:goals-manifest`.
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
  createIssue,
  updateIssue,
  ensureLabel,
  invalidateIssueCache,
  setGitHubContext,
  clearGitHubContext,
} from '@dashboard/lib/github-client'
import {
  EMPTY_MANIFEST,
  GOALS_MANIFEST_LABEL,
  MANIFEST_ISSUE_TITLE,
  goalLabel,
  parseManifestBody,
  serializeManifestBody,
  slugifyGoalName,
  uniqueGoalId,
  type Goal,
  type GoalsManifest,
} from '@dashboard/lib/goals'

const GOAL_LABEL_COLOR = '38bdf8' // Tailwind sky-400
import { Octokit } from '@octokit/rest'

type ManifestIssueRef = { number: number; body: string }

async function findManifestIssue(): Promise<ManifestIssueRef | null> {
  // Short TTL keeps cross-instance staleness bounded. Post-TTL revalidation
  // returns 304 (free) via the cached ETag when nothing changed; on writes,
  // the route invalidates this instance's cache directly.
  const issues = await fetchIssues({
    state: 'open',
    labels: GOALS_MANIFEST_LABEL,
    perPage: 5,
    ttl: 15_000,
  })
  if (!issues.length) return null
  // If multiple exist, prefer the earliest created (stable anchor).
  const sorted = [...issues].sort((a, b) => a.number - b.number)
  const first = sorted[0]
  const full = await fetchIssue(first.number, { ttl: 15_000 })
  return { number: first.number, body: full?.body ?? '' }
}

async function readManifest(): Promise<{
  manifest: GoalsManifest
  issue: ManifestIssueRef | null
}> {
  const issue = await findManifestIssue()
  const manifest = issue
    ? parseManifestBody(issue.body)
    : { ...EMPTY_MANIFEST, goals: [] }
  return { manifest, issue }
}

async function writeManifest(
  next: GoalsManifest,
  existing: ManifestIssueRef | null,
  userOctokit?: Octokit,
): Promise<ManifestIssueRef> {
  const body = serializeManifestBody(next)
  if (existing) {
    await updateIssue(existing.number, { body }, userOctokit)
    return { number: existing.number, body }
  }
  const created = await createIssue(
    {
      title: MANIFEST_ISSUE_TITLE,
      body,
      labels: [GOALS_MANIFEST_LABEL],
    },
    userOctokit,
  )
  return { number: created.number, body }
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

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { manifest, issue } = await readManifest()
    return NextResponse.json(
      {
        goals: manifest.goals,
        manifest: { issueNumber: issue?.number ?? null },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error: any) {
    console.error('[Goals] Error listing goals:', error)
    return mapGithubError(error, 'list_failed')
  } finally {
    clearGitHubContext()
  }
}

const createGoalSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  dueDate: z.string().optional(),
  actorLogin: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const payload = await req.json()
    const parsed = createGoalSchema.parse(payload)

    const actorResult = await verifyActorLogin(req, parsed.actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)

    const { manifest, issue } = await readManifest()
    const id = uniqueGoalId(slugifyGoalName(parsed.name), manifest.goals)
    const now = new Date().toISOString()
    const newGoal: Goal = {
      id,
      name: parsed.name.trim(),
      description: parsed.description?.trim() || undefined,
      dueDate: parsed.dueDate?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }
    const nextManifest: GoalsManifest = {
      version: 1,
      goals: [...manifest.goals, newGoal],
    }

    const written = await writeManifest(nextManifest, issue, userOctokit ?? undefined)

    // Same-instance writes: drop cached issue/listings so the next read on
    // this instance reflects the new manifest immediately.
    invalidateIssueCache(written.number)

    // Pre-create the `goal:<id>` repo label so attach operations later don't
    // 422. GitHub's addLabels endpoint requires the label to exist already.
    try {
      await ensureLabel(
        goalLabel(newGoal.id),
        {
          color: GOAL_LABEL_COLOR,
          description: `Tasks attached to goal: ${newGoal.name}`,
        },
        userOctokit ?? undefined,
      )
    } catch (labelErr) {
      // Non-fatal — the add-label action route will ensure on-demand too
      console.warn('[Goals] ensureLabel failed (continuing):', labelErr)
    }

    return NextResponse.json({ goal: newGoal })
  } catch (error: any) {
    console.error('[Goals] Error creating goal:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'validation_error', details: error.issues },
        { status: 400 },
      )
    }
    return mapGithubError(error, 'create_failed')
  } finally {
    clearGitHubContext()
  }
}
