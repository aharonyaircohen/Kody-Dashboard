/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern prs-comments-api
 * @ai-summary API route to fetch and post PR comments
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { handleKodyApiError } from '@dashboard/lib/github-error-handler'
import { requireKodyAuth, getUserOctokit, verifyActorLogin } from '@dashboard/lib/auth'
import { fetchPRComments, postComment, invalidateTaskCache } from '@dashboard/lib/github-client'

const getSchema = z.object({
  prNumber: z.coerce.number().int().positive(),
})

const postSchema = z.object({
  prNumber: z.number().int().positive(),
  body: z.string().min(1),
  actorLogin: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  try {
    const { searchParams } = new URL(req.url)
    const parsed = getSchema.safeParse({ prNumber: searchParams.get('prNumber') })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid prNumber' }, { status: 400 })
    }

    const comments = await fetchPRComments(parsed.data.prNumber)
    return NextResponse.json({ comments })
  } catch (error: unknown) {
    return handleKodyApiError(error, 'pr-comments')
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  try {
    const body = await req.json()
    const parsed = postSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 },
      )
    }

    const { prNumber, body: commentBody, actorLogin } = parsed.data

    // Verify actorLogin matches authenticated session to prevent impersonation
    if (actorLogin) {
      const verified = await verifyActorLogin(req, actorLogin)
      if (verified instanceof NextResponse) return verified
    }

    // Use user's Octokit so comments appear under their identity
    const userOctokit = await getUserOctokit(req)
    const fullBody =
      actorLogin && !userOctokit ? `${commentBody}\n\n_(posted by @${actorLogin})_` : commentBody

    // GitHub API: PR comments use the same endpoint as issue comments
    await postComment(prNumber, fullBody, userOctokit ?? undefined)
    invalidateTaskCache()

    return NextResponse.json({ success: true, message: 'Comment posted' })
  } catch (error: unknown) {
    return handleKodyApiError(error, 'pr-comments')
  }
}
