/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern approve-gate
 * @ai-summary Approve a gate - merge PR, delete branch, close issue, remove labels via GitHub API.
 *   Uses per-user GitHub token when available for proper attribution.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKodyAuth, verifyActorLogin, getUserOctokit, getRequestAuth } from '@dashboard/lib/auth'
import { getOctokit, setGitHubContext, clearGitHubContext, getOwner, getRepo } from '@dashboard/lib/github-client'
import { isProtectedBranch } from '@dashboard/lib/branches/protected-branches'

// Zod schema for request validation
const ApproveRequestSchema = z.object({
  issueNumber: z.number().int().positive(),
  prNumber: z.number().int().positive(),
  branchName: z.string().optional(),
  actorLogin: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)
  }

  try {
    const body = await req.json()
    const parsed = ApproveRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { issueNumber, prNumber, branchName, actorLogin } = parsed.data

    // Verify actorLogin matches the authenticated session (prevents impersonation)
    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult
    const { identity } = actorResult

    const verifiedLogin = identity.login

    // Use user's Octokit for proper attribution (reviews, merges appear under user's identity)
    const userOctokit = await getUserOctokit(req)
    const octokit = userOctokit ?? getOctokit()
    const results: string[] = []

    // 1. Approve and merge the PR (squash)
    try {
      await octokit.pulls.createReview({
        owner: getOwner(),
        repo: getRepo(),
        pull_number: prNumber,
        event: 'APPROVE',
        body: `✅ Gate approved by @${verifiedLogin} via Kody dashboard.`,
      })
    } catch {
      // May fail if already approved
    }

    try {
      await octokit.pulls.merge({
        owner: getOwner(),
        repo: getRepo(),
        pull_number: prNumber,
        merge_method: 'squash',
      })
      results.push(`Merged PR #${prNumber}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('not mergeable') || msg.includes('405')) {
        results.push(`PR #${prNumber} approved, merge may require CI checks to pass`)
      } else if (!msg.includes('already merged') && !msg.includes('Already up to date')) {
        console.error(`PR merge error: ${msg}`)
      }
      results.push(`PR #${prNumber} merged or already up to date`)
    }

    // 2. Delete the branch (if provided and not protected)
    if (branchName && !isProtectedBranch(branchName)) {
      try {
        await octokit.git.deleteRef({
          owner: getOwner(),
          repo: getRepo(),
          ref: `heads/${branchName}`,
        })
        results.push(`Deleted branch ${branchName}`)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        results.push(`Branch ${branchName} deleted or not found: ${msg}`)
      }
    }

    // 3. Close the issue
    try {
      await octokit.issues.update({
        owner: getOwner(),
        repo: getRepo(),
        issue_number: issueNumber,
        state: 'closed',
      })
      results.push(`Closed issue #${issueNumber}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push(`Issue close note: ${msg}`)
    }

    return NextResponse.json({ success: true, results })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Kody] Approve error:', msg)

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
  } finally {
    clearGitHubContext()
  }
}
