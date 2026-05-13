/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern changelog-api
 *
 * GET /api/kody/changelog — Fetches CHANGELOG.md from the connected repo.
 * Read-only: the file is maintained by webhook handlers
 * (changelog/handlers.ts) on `pull_request closed+merged` and
 * `release published` events. Returns an empty body with htmlUrl:null
 * when the file doesn't exist yet.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth"
import { getOctokit, setGitHubContext, clearGitHubContext } from "@dashboard/lib/github-client"
import { readChangelog } from "@dashboard/lib/changelog/file"

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)
  }

  try {
    const octokit = getOctokit()
    const owner = headerAuth?.owner ?? process.env.GITHUB_OWNER ?? ""
    const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? ""
    if (!owner || !repo) {
      return NextResponse.json(
        { error: "missing_repo_context" },
        { status: 400 },
      )
    }

    const file = await readChangelog(octokit, owner, repo)
    return NextResponse.json({
      content: file.content,
      htmlUrl: file.htmlUrl,
    })
  } catch (error) {
    const status = (error as { status?: number }).status
    const message = error instanceof Error ? error.message : String(error)
    if (status === 401) {
      return NextResponse.json({ error: "github_token_expired" }, { status: 401 })
    }
    if (status === 403 || message.includes("rate limit")) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429 },
      )
    }
    return NextResponse.json(
      { content: "", htmlUrl: null, error: message },
      { status: 500 },
    )
  } finally {
    clearGitHubContext()
  }
}
