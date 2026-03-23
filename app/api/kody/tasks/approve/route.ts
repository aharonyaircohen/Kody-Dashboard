/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern approve-gate
 * @ai-summary Approve a gate - merge PR, delete branch, close issue, remove labels via GitHub API.
 *   Uses per-user GitHub token when available for proper attribution.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKodyAuth, verifyActorLogin, getUserOctokit } from '@dashboard/lib/auth'
import { GITHUB_OWNER, GITHUB_REPO } from '@dashboard/lib/constants'
import { getOctokit } from '@dashboard/lib/github-client'

const GATE_LABELS = {
  HARD_STOP: 'hard-stop',
  RISK_GATED: 'risk-gated',
} as const

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
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        pull_number: prNumber,
        event: 'APPROVE',
        body: `✅ Gate approved by @${verifiedLogin} via Kody dashboard.`,
      })
    } catch {
      // May fail if already approved
    }

    try {
      await octokit.pulls.merge({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
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
    if (branchName && branchName !== 'dev' && branchName !== 'main') {
      try {
        await octokit.git.deleteRef({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
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
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        issue_number: issueNumber,
        state: 'closed',
      })
      results.push(`Closed issue #${issueNumber}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push(`Issue close note: ${msg}`)
    }

    // 4. Remove gate labels
    for (const label of [GATE_LABELS.HARD_STOP, GATE_LABELS.RISK_GATED]) {
      try {
        await octokit.issues.removeLabel({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          issue_number: issueNumber,
          name: label,
        })
      } catch {
        // Label might not be present
      }
    }
    results.push('Removed gate labels')

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
  }
}
