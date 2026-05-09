/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern jobs-api
 * @ai-summary Job Control API — GET lists jobs, POST creates one.
 *   A job is a markdown file at `.kody/jobs/<slug>.md` in the
 *   connected repo. The kody engine's job-scheduler enumerates the same
 *   directory and ticks each file every cron wake.
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
  listJobFiles,
  readJobFile,
  writeJobFile,
  isValidSlug,
} from '@dashboard/lib/jobs-files'

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const jobs = await listJobFiles()
    return NextResponse.json({ jobs })
  } catch (error: any) {
    console.error('[Jobs] Error fetching jobs:', error)

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
      { jobs: [], error: error?.message || 'Failed to fetch jobs' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}

const createJobSchema = z.object({
  slug: z.string().min(1).max(64).optional(),
  title: z.string().min(1),
  body: z.string().default(''),
  schedule: z.enum(['15m', '30m', '1h', '6h', '1d']).nullable().optional(),
  actorLogin: z.string().optional(),
})

function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const payload = await req.json()
    const { slug: requestedSlug, title, body, schedule, actorLogin } = createJobSchema.parse(payload)

    const slug = (requestedSlug ?? slugifyTitle(title))
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json(
        { error: 'invalid_slug', message: 'Job slug must be lowercase letters, digits, dashes, or underscores.' },
        { status: 400 },
      )
    }

    const existing = await readJobFile(slug)
    if (existing) {
      return NextResponse.json(
        { error: 'slug_taken', message: `Job "${slug}" already exists.` },
        { status: 409 },
      )
    }

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
      title,
      body,
      schedule: schedule ?? null,
    })

    return NextResponse.json({ job })
  } catch (error: any) {
    console.error('[Jobs] Error creating job:', error)

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
      { error: 'create_failed', message: error?.message ?? 'Failed to create job' },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}
