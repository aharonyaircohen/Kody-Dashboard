/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern approve-review
 * @ai-summary Approve a PR review and merge it via GitHub API (Octokit).
 *   All PRs (feature and publish) use standard squash merge.
 *   Uses per-user GitHub token when available for proper attribution.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKodyAuth, verifyActorLogin, getUserOctokit } from '@dashboard/lib/auth'
import { getOctokit } from '@dashboard/lib/github-client'
import { GITHUB_OWNER, GITHUB_REPO } from '@dashboard/lib/constants'

const DEV_BRANCH = 'dev'
const PROD_BRANCH = 'main'

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  // Zod validation schema
  const bodySchema = z.object({
    prNumber: z.number().int().positive(),
    actorLogin: z.string().optional(),
  })

  try {
    const body = await req.json()
    const validated = bodySchema.parse(body)
    const { prNumber, actorLogin } = validated

    // Verify actorLogin matches the authenticated session (prevents impersonation)
    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult
    const { identity } = actorResult

    const verifiedLogin = identity.login

    // Use user's Octokit for proper attribution (reviews, merges appear under user's identity)
    const userOctokit = await getUserOctokit(req)
    const octokit = userOctokit ?? getOctokit()
    const results: string[] = []

    // Fetch PR data once, reuse throughout
    const { data: prData } = await octokit.pulls.get({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      pull_number: Number(prNumber),
    })

    const isPublishPR = prData.head.ref === DEV_BRANCH && prData.base.ref === PROD_BRANCH

    // 1. Approve the PR review
    try {
      await octokit.pulls.createReview({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        pull_number: Number(prNumber),
        event: 'APPROVE',
        body: `✅ Approved by @${verifiedLogin} via Kody dashboard.`,
      })
      results.push(`Approved PR #${prNumber}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push(`Review note: ${msg}`)
    }

    // 2. Merge the PR (squash merge for all PRs)
    try {
      const mergeMethod = isPublishPR ? 'merge' : 'squash'
      await octokit.pulls.merge({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        pull_number: Number(prNumber),
        merge_method: mergeMethod,
      })
      results.push(`Merged PR #${prNumber} (${mergeMethod})`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('not mergeable') || msg.includes('405')) {
        return NextResponse.json(
          {
            error:
              'PR is not mergeable — CI may still be running, checks have failed, or there are merge conflicts',
            results,
          },
          { status: 409 },
        )
      }
      throw error
    }

    // 3. Delete the branch (only for feature branches, not dev or main)
    if (!isPublishPR) {
      try {
        const branchRef = prData.head.ref
        if (branchRef !== DEV_BRANCH && branchRef !== PROD_BRANCH) {
          await octokit.git.deleteRef({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            ref: `heads/${branchRef}`,
          })
          results.push(`Deleted branch ${branchRef}`)
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        results.push(`Branch cleanup note: ${msg}`)
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error: unknown) {
    // Handle ZodError specifically
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 },
      )
    }

    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Kody] Merge error:', msg)

    // Capture to Sentry
    const Sentry = await import('@sentry/nextjs')
    Sentry.captureException(error, { tags: { route: '/api/kody/tasks/approve-review' } })

    // User's GitHub token expired/revoked
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      (error as { status?: number }).status === 401
    ) {
      return NextResponse.json(
        {
          error: 'github_token_expired',
          message: 'Your GitHub token has expired. Please log in again.',
        },
        { status: 401 },
      )
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
