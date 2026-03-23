/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern publish
 * @ai-summary Create a GitHub issue with 'publish' label to trigger dev→main PR workflow.
 *   Uses per-user GitHub token when available for proper attribution.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireKodyAuth, verifyActorLogin, getUserOctokit } from '@dashboard/lib/auth'
import { GITHUB_OWNER, GITHUB_REPO, DEV_BRANCH, PROD_BRANCH } from '@dashboard/lib/constants'
import { getOctokit } from '@dashboard/lib/github-client'

const PUBLISH_LABEL = 'publish'

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  try {
    const body = await req.json().catch(() => ({}))
    const actorLogin = body?.actorLogin as string | undefined

    // Verify actorLogin matches the authenticated session (prevents impersonation)
    const actorResult = await verifyActorLogin(req, actorLogin)
    if (actorResult instanceof NextResponse) return actorResult
    const { identity } = actorResult

    const verifiedLogin = identity.login

    // Use user's Octokit for writes, bot for reads
    const userOctokit = await getUserOctokit(req)
    const readOctokit = getOctokit() // reads always use bot token (doesn't consume user rate limit)
    const writeOctokit = userOctokit ?? readOctokit

    // 1. Check if dev is ahead of main (read operation — use bot token)
    const { data: comparison } = await readOctokit.repos.compareCommits({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      base: PROD_BRANCH,
      head: DEV_BRANCH,
    })

    if (comparison.ahead_by === 0) {
      return NextResponse.json({
        success: true,
        message: 'Nothing to publish — dev is already up to date with main.',
      })
    }

    // 2. Check for existing open publish issue (read operation — use bot token)
    const { data: existingIssues } = await readOctokit.issues.listForRepo({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      labels: PUBLISH_LABEL,
      state: 'open',
    })

    // Filter out PRs (GitHub API returns PRs in issue list)
    const publishIssues = existingIssues.filter((i) => !i.pull_request)

    if (publishIssues.length > 0) {
      const existing = publishIssues[0]
      return NextResponse.json({
        success: true,
        message: `Publish already in progress — issue #${existing.number}`,
        issueNumber: existing.number,
        issueUrl: existing.html_url,
      })
    }

    // 3. Create the publish issue (write operation — use user token for attribution)
    const { data: issue } = await writeOctokit.issues.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title: `Publish dev → production (${comparison.ahead_by} commits)`,
      body: [
        '## Publish to Production',
        '',
        `Merging \`${DEV_BRANCH}\` into \`${PROD_BRANCH}\` — **${comparison.ahead_by} commits** ahead.`,
        '',
        `This issue was created by @${verifiedLogin} via the Kody dashboard Publish button.`,
        'A GitHub Action will automatically create a PR from `dev` → `main`.',
        'Once CI passes, use the Merge button in the dashboard to finalize.',
      ].join('\n'),
      labels: [PUBLISH_LABEL],
    })

    return NextResponse.json({
      success: true,
      message: `Publish issue #${issue.number} created`,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Kody] Publish error:', msg)

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

    return NextResponse.json({ error: msg || 'Publish failed' }, { status: 500 })
  }
}
