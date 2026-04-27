/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern missions-api
 * @ai-summary Mission Control API — GET lists missions, POST creates one.
 *   A mission is a markdown file at `.kody/missions/<slug>.md` in the
 *   connected repo. The kody engine's mission-scheduler enumerates the same
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
  listMissionFiles,
  readMissionFile,
  writeMissionFile,
  isValidSlug,
} from '@dashboard/lib/missions-files'

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)

  try {
    const missions = await listMissionFiles()
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
  slug: z.string().min(1).max(64).optional(),
  title: z.string().min(1),
  body: z.string().default(''),
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
    const { slug: requestedSlug, title, body, actorLogin } = createMissionSchema.parse(payload)

    const slug = (requestedSlug ?? slugifyTitle(title))
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json(
        { error: 'invalid_slug', message: 'Mission slug must be lowercase letters, digits, dashes, or underscores.' },
        { status: 400 },
      )
    }

    const existing = await readMissionFile(slug)
    if (existing) {
      return NextResponse.json(
        { error: 'slug_taken', message: `Mission "${slug}" already exists.` },
        { status: 409 },
      )
    }

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
      title,
      body,
    })

    return NextResponse.json({ mission })
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
