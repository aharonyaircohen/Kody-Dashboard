/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern missions-api
 * @ai-summary Mission Control API — GET lists missions, POST creates one.
 *   A mission is a GitHub issue carrying the `kody:mission` label. Unlike tasks,
 *   missions never auto-trigger the @kody pipeline.
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
  createIssue,
  setGitHubContext,
  clearGitHubContext,
} from '@dashboard/lib/github-client'
import { MISSION_LABEL } from '@dashboard/lib/missions'

function toMission(issue: {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: Array<{ name: string }>
  created_at: string
  updated_at: string
  html_url: string
  assignees: Array<{ login: string; avatar_url: string }>
}) {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state,
    labels: issue.labels.map((l) => l.name),
    assignees: issue.assignees,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    htmlUrl: issue.html_url,
  }
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const issues = await fetchIssues({
      state: 'open',
      labels: MISSION_LABEL,
      perPage: 100,
    })

    const missions = issues.map(toMission)
    return NextResponse.json({ missions })
  } catch (error: any) {
    console.error('[Missions] Error fetching missions:', error)

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
      { missions: [], error: error?.message || 'Failed to fetch missions' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}

const createMissionSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(''),
  actorLogin: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const payload = await req.json()
    const { title, body, actorLogin } = createMissionSchema.parse(payload)

    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)

    const issue = await createIssue(
      {
        title,
        body,
        labels: [MISSION_LABEL],
      },
      userOctokit ?? undefined,
    )

    return NextResponse.json({
      mission: toMission({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        state: issue.state,
        labels: issue.labels,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        html_url: issue.html_url,
        assignees: issue.assignees,
      }),
    })
  } catch (error: any) {
    console.error('[Missions] Error creating mission:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'validation_error', details: error.issues },
        { status: 400 },
      )
    }

    if (error?.status === 401) {
      return NextResponse.json({ error: 'github_token_expired' }, { status: 401 })
    }

    return NextResponse.json(
      { error: 'create_failed', message: error?.message ?? 'Failed to create mission' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}
