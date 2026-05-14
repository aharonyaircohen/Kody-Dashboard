/**
 * @fileType endpoint
 * @domain kody
 * @pattern branches-api
 * @ai-summary API route for listing and deleting branches from GitHub.
 *   Uses per-user GitHub token for write operations (delete) when available.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKodyAuth, getUserOctokit, getRequestAuth } from '@dashboard/lib/auth'
import { getOctokit, setGitHubContext, clearGitHubContext, getOwner, getRepo } from '@dashboard/lib/github-client'
import { isProtectedBranch } from '@dashboard/lib/branches'

const DELETE_BRANCH_SCHEMA = z.object({
  branch: z.string(),
})

const BULK_DELETE_SCHEMA = z.object({
  branches: z.array(z.string()),
})

// GET /api/kody/branches - List branches from GitHub (read — always bot token)
export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)
  }

  try {
    const octokit = getOctokit()

    // Get all branches from the repository
    const { data: branches } = await octokit.rest.repos.listBranches({
      owner: getOwner(),
      repo: getRepo(),
      per_page: 100,
    })

    // Get all PRs to map branches to their status
    const { data: prs } = await octokit.rest.pulls.list({
      owner: getOwner(),
      repo: getRepo(),
      state: 'all',
      per_page: 100,
    })

    // Map branches to PR status
    const prBranches = new Map(prs.map((pr) => [pr.head.ref, pr.state]))

    // Filter out protected branches (main / master / dev) — these are never
    // deletable from the UI so showing them as deletion candidates is noise.
    const branchInfo = branches
      .filter((b) => !isProtectedBranch(b.name))
      .map((branch) => {
        const prState = prBranches.get(branch.name)
        let status: 'active' | 'merged' | 'closed' = 'active'

        if (prState === 'closed') {
          const pr = prs.find((p) => p.head.ref === branch.name)
          status = pr?.merged_at ? 'merged' : 'closed'
        }

        return {
          name: branch.name,
          status,
          protected: branch.protected,
        }
      })
      .filter((b) => b.status !== 'active') // Only show non-active branches

    return NextResponse.json(branchInfo)
  } catch (error) {
    console.error('Error fetching branches:', error)
    return NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 })
  } finally {
    clearGitHubContext()
  }
}

// DELETE /api/kody/branches - Delete a single branch (write — use user token)
export async function DELETE(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)
  }

  try {
    const userOctokit = await getUserOctokit(req)
    const octokit = userOctokit ?? getOctokit()

    const body = await req.json()
    const { branch } = DELETE_BRANCH_SCHEMA.parse(body)

    // Don't allow deleting protected branches (main / master / dev)
    if (isProtectedBranch(branch)) {
      return NextResponse.json({ error: 'Cannot delete protected branch' }, { status: 400 })
    }

    try {
      await octokit.rest.git.deleteRef({
        owner: getOwner(),
        repo: getRepo(),
        ref: `heads/${branch}`,
      })
      return NextResponse.json({ success: true, branch })
    } catch (githubError) {
      const error = githubError as { status?: number }
      if (error.status === 422) {
        return NextResponse.json({ error: 'Branch not found or already deleted' }, { status: 404 })
      }
      throw githubError
    }
  } catch (error) {
    console.error('Error deleting branch:', error)
    return NextResponse.json({ error: 'Failed to delete branch' }, { status: 500 })
  } finally {
    clearGitHubContext()
  }
}

// POST /api/kody/branches - Bulk delete branches (write — use user token)
export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)
  }

  try {
    const userOctokit = await getUserOctokit(req)
    const octokit = userOctokit ?? getOctokit()

    const body = await req.json()
    const { branches } = BULK_DELETE_SCHEMA.parse(body)

    const results: { branch: string; success: boolean; error?: string }[] = []

    for (const branch of branches) {
      if (isProtectedBranch(branch)) {
        results.push({ branch, success: false, error: 'Cannot delete protected branch' })
        continue
      }

      try {
        await octokit.rest.git.deleteRef({
          owner: getOwner(),
          repo: getRepo(),
          ref: `heads/${branch}`,
        })
        results.push({ branch, success: true })
      } catch (githubError) {
        const error = githubError as { message?: string }
        results.push({
          branch,
          success: false,
          error: error.message || 'Failed to delete',
        })
      }
    }

    const allSuccess = results.every((r) => r.success)
    return NextResponse.json({
      success: allSuccess,
      results,
    })
  } catch (error) {
    console.error('Error deleting branches:', error)
    return NextResponse.json({ error: 'Failed to delete branches' }, { status: 500 })
  } finally {
    clearGitHubContext()
  }
}
