/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern collaborators-api
 * @ai-summary API route to fetch repository collaborators for assignee picker
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireKodyAuth } from '@dashboard/lib/auth'

import { fetchCollaborators } from '@dashboard/lib/github-client'

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  try {
    const collaborators = await fetchCollaborators()
    return NextResponse.json({ collaborators })
  } catch (error) {
    console.error('[Kody] Error fetching collaborators:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to fetch collaborators', details: message },
      { status: 500 },
    )
  }
}
