/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern missions-api
 * @ai-summary Mission detail API — GET reads a single mission, PATCH updates
 *   the title/body, DELETE closes the issue. Missions never trigger @kody.
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
  fetchIssue,
  updateIssue,
  setGitHubContext,
  clearGitHubContext,
} from '@dashboard/lib/github-client'
import { MISSION_LABEL } from '@dashboard/lib/missions'

function ensureIsMission(labels: Array<{ name: string }>): boolean {
  return labels.some((l) => l.name.toLowerCase() === MISSION_LABEL)
}

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

async function resolveMission(numberStr: string) {
  const number = Number.parseInt(numberStr, 10)
  if (!Number.isFinite(number)) return { error: 'bad_number' as const }
  const issue = await fetchIssue(number)
  if (!issue) return { error: 'not_found' as const }
  if (!ensureIsMission(issue.labels)) return { error: 'not_mission' as const, issue }
  return { issue }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { number } = await params
    const resolved = await resolveMission(number)
    if (resolved.error === 'bad_number') {
      return NextResponse.json({ error: 'invalid_number' }, { status: 400 })
    }
    if (resolved.error === 'not_found' || resolved.error === 'not_mission') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({ mission: toMission(resolved.issue) })
  } catch (error: any) {
    console.error('[Missions] Error fetching mission:', error)
    return NextResponse.json(
      { error: 'fetch_failed', message: error?.message ?? 'Failed to fetch mission' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}

const updateMissionSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  actorLogin: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { number } = await params
    const resolved = await resolveMission(number)
    if (resolved.error === 'bad_number') {
      return NextResponse.json({ error: 'invalid_number' }, { status: 400 })
    }
    if (resolved.error === 'not_found' || resolved.error === 'not_mission') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const payload = await req.json()
    const { title, body, actorLogin } = updateMissionSchema.parse(payload)

    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)

    await updateIssue(
      resolved.issue.number,
      {
        title,
        body,
      },
      userOctokit ?? undefined,
    )

    // Re-read so the client gets the authoritative record
    const refreshed = await fetchIssue(resolved.issue.number)
    if (!refreshed) {
      return NextResponse.json({ error: 'fetch_after_update_failed' }, { status: 500 })
    }

    return NextResponse.json({ mission: toMission(refreshed) })
  } catch (error: any) {
    console.error('[Missions] Error updating mission:', error)

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
      { error: 'update_failed', message: error?.message ?? 'Failed to update mission' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { number } = await params
    const resolved = await resolveMission(number)
    if (resolved.error === 'bad_number') {
      return NextResponse.json({ error: 'invalid_number' }, { status: 400 })
    }
    if (resolved.error === 'not_found' || resolved.error === 'not_mission') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    // Deleting an issue requires admin privileges; closing is the standard path
    // and lets the user reopen from GitHub if needed.
    const { searchParams } = new URL(req.url)
    const actorLogin = searchParams.get('actorLogin') ?? undefined

    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)

    await updateIssue(
      resolved.issue.number,
      { state: 'closed' },
      userOctokit ?? undefined,
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Missions] Error deleting mission:', error)
    if (error?.status === 401) {
      return NextResponse.json({ error: 'github_token_expired' }, { status: 401 })
    }
    return NextResponse.json(
      { error: 'delete_failed', message: error?.message ?? 'Failed to delete mission' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}
