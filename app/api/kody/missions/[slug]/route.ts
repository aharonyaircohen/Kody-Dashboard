/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern missions-api
 * @ai-summary Mission detail API — GET reads a single mission file, PATCH
 *   updates the title/body, DELETE removes the file. Backed by `.kody/missions/<slug>.md`
 *   via the GitHub contents API.
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
import { setGitHubContext, clearGitHubContext } from '@dashboard/lib/github-client'
import {
  readMissionFile,
  writeMissionFile,
  deleteMissionFile,
  isValidSlug,
} from '@dashboard/lib/missions-files'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { slug } = await params
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: 'invalid_slug' }, { status: 400 })
    }
    const mission = await readMissionFile(slug)
    if (!mission) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({ mission })
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
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { slug } = await params
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: 'invalid_slug' }, { status: 400 })
    }

    const existing = await readMissionFile(slug)
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const payload = await req.json()
    const { title, body, actorLogin } = updateMissionSchema.parse(payload)

    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)
    if (!userOctokit) {
      return NextResponse.json(
        { error: 'no_user_token', message: 'A signed-in GitHub token is required to commit mission files.' },
        { status: 401 },
      )
    }

    const mission = await writeMissionFile({
      octokit: userOctokit,
      slug,
      title: title ?? existing.title,
      body: body ?? existing.body,
      sha: existing.sha,
    })

    return NextResponse.json({ mission })
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
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const { slug } = await params
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: 'invalid_slug' }, { status: 400 })
    }

    const existing = await readMissionFile(slug)
    if (!existing) {
      return NextResponse.json({ success: true, alreadyMissing: true })
    }

    const { searchParams } = new URL(req.url)
    const actorLogin = searchParams.get('actorLogin') ?? undefined

    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)
    if (!userOctokit) {
      return NextResponse.json(
        { error: 'no_user_token', message: 'A signed-in GitHub token is required to delete mission files.' },
        { status: 401 },
      )
    }

    await deleteMissionFile(userOctokit, slug)

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
