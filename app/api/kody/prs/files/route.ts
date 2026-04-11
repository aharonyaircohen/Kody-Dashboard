/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern pr-files-api
 * @ai-summary API route to fetch file changes for a PR
 */
import { NextRequest, NextResponse } from 'next/server'

import { handleKodyApiError } from '@dashboard/lib/github-error-handler'
import { prFilesQuerySchema } from '@dashboard/lib/schemas'
import { parseQueryParams } from '@dashboard/lib/api-responses'
import { requireKodyAuth, getRequestAuth } from '@dashboard/lib/auth'
import { fetchPRFileChanges, setGitHubContext, clearGitHubContext } from '@dashboard/lib/github-client'

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  // Validate query params
  const parsed = parseQueryParams(req, prFilesQuerySchema)
  if ('error' in parsed) return parsed.error
  const { prNumber } = parsed.data

  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token)
  }

  try {
    const files = await fetchPRFileChanges(prNumber)

    return NextResponse.json({ files })
  } catch (error: unknown) {
    return handleKodyApiError(error, 'prs/files')
  } finally {
    clearGitHubContext()
  }
}
