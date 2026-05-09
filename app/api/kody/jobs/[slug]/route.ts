/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern jobs-api
 * @ai-summary Job detail API — GET reads a single job file, PATCH
 *   updates the title/body, DELETE removes the file. Backed by `.kody/jobs/<slug>.md`
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
  readJobFile,
  writeJobFile,
  deleteJobFile,
  isValidSlug,
} from '@dashboard/lib/jobs-files'

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
    const job = await readJobFile(slug)
    if (!job) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({ job })
  } catch (error: any) {
    console.error('[Jobs] Error fetching job:', error)
    return NextResponse.json(
      { error: 'fetch_failed', message: error?.message ?? 'Failed to fetch job' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}

const updateJobSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  schedule: z
    .enum(['15m', '30m', '1h', '2h', '6h', '12h', '1d', '3d', '7d', 'manual'])
    .nullable()
    .optional(),
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

    const existing = await readJobFile(slug)
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const payload = await req.json()
    const { title, body, schedule, actorLogin } = updateJobSchema.parse(payload)

    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult

    const userOctokit = await getUserOctokit(req)
    if (!userOctokit) {
      return NextResponse.json(
        { error: 'no_user_token', message: 'A signed-in GitHub token is required to commit job files.' },
        { status: 401 },
      )
    }

    const job = await writeJobFile({
      octokit: userOctokit,
      slug,
      title: title ?? existing.title,
      body: body ?? existing.body,
      schedule: schedule === undefined ? existing.schedule : schedule,
      sha: existing.sha,
    })

    return NextResponse.json({ job })
  } catch (error: any) {
    console.error('[Jobs] Error updating job:', error)

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
      { error: 'update_failed', message: error?.message ?? 'Failed to update job' },
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

    const existing = await readJobFile(slug)
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
        { error: 'no_user_token', message: 'A signed-in GitHub token is required to delete job files.' },
        { status: 401 },
      )
    }

    await deleteJobFile(userOctokit, slug)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Jobs] Error deleting job:', error)
    if (error?.status === 401) {
      return NextResponse.json({ error: 'github_token_expired' }, { status: 401 })
    }
    return NextResponse.json(
      { error: 'delete_failed', message: error?.message ?? 'Failed to delete job' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}
