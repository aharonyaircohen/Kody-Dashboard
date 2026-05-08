/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern default-branch-ci-api
 * @ai-summary Roll-up of latest CI state on the connected repo's default branch.
 *   Banner uses this to surface whether `main` is green/red — autonomous agents
 *   start work from main, so a red main blocks the entire pipeline.
 */
import { NextRequest, NextResponse } from 'next/server'

import { handleKodyApiError } from '@dashboard/lib/github-error-handler'
import { requireKodyAuth, getRequestAuth } from '@dashboard/lib/auth'
import {
  fetchDefaultBranchCI,
  setGitHubContext,
  clearGitHubContext,
} from '@dashboard/lib/github-client'

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)
  }

  try {
    const ci = await fetchDefaultBranchCI()
    return NextResponse.json(ci)
  } catch (error: unknown) {
    return handleKodyApiError(error, 'ci/main')
  } finally {
    clearGitHubContext()
  }
}
