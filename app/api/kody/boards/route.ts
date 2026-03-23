/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern boards-api
 * @ai-summary API route to fetch boards (labels + milestones)
 *
 * Public endpoint (no auth required) — returns board categories.
 * Intentionally unauthenticated to support dashboard loading without login.
 */
import { NextRequest, NextResponse } from 'next/server'

import { handleKodyApiError } from '@dashboard/lib/github-error-handler'
import { requireKodyAuth } from '@dashboard/lib/auth'
import { fetchLabels, fetchMilestones } from '@dashboard/lib/github-client'
import type { Board } from '@dashboard/lib/types'

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  try {
    // Fetch labels and milestones in parallel
    const [labels, milestones] = await Promise.all([fetchLabels(), fetchMilestones()])

    // Build board list
    const boards: Board[] = [
      { id: 'all', name: 'All', type: 'all' },
      ...labels.map((label) => ({
        id: `label:${label.name}`,
        name: label.name,
        type: 'label' as const,
      })),
      ...milestones.map((milestone) => ({
        id: `milestone:${milestone.number}`,
        name: milestone.title,
        type: 'milestone' as const,
      })),
    ]

    return NextResponse.json({ boards })
  } catch (error: unknown) {
    return handleKodyApiError(error, 'boards')
  }
}
