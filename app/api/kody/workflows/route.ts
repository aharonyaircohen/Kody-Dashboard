/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern workflows-api
 * @ai-summary API route to fetch workflow runs
 */
import { NextRequest, NextResponse } from 'next/server'

import { handleKodyApiError } from '@dashboard/lib/github-error-handler'
import { workflowsQuerySchema } from '@dashboard/lib/schemas'
import { parseQueryParams } from '@dashboard/lib/api-responses'
import { requireKodyAuth } from '@dashboard/lib/auth'
import { fetchWorkflowRuns } from '@dashboard/lib/github-client'

export async function GET(req: NextRequest) {
  // Check auth
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  // Validate query params
  const parsed = parseQueryParams(req, workflowsQuerySchema)
  if ('error' in parsed) return parsed.error
  const { status } = parsed.data

  try {
    const runs = await fetchWorkflowRuns({
      status,
      perPage: 20,
    })

    return NextResponse.json({ runs })
  } catch (error: unknown) {
    return handleKodyApiError(error, 'workflows')
  }
}
