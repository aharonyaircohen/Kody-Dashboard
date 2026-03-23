/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern pr-ci-status
 * @ai-summary Fetch CI status and mergeability for a PR
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKodyAuth } from '@dashboard/lib/auth'
import { fetchPRCIStatus } from '@dashboard/lib/github-client'
import { logger } from '@dashboard/lib/logger'

const querySchema = z.object({
  prNumber: z.coerce.number().int().positive(),
})

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  try {
    const { searchParams } = new URL(req.url)
    const parsed = querySchema.safeParse({ prNumber: searchParams.get('prNumber') })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid prNumber: must be a positive integer' },
        { status: 400 },
      )
    }

    const status = await fetchPRCIStatus(parsed.data.prNumber)

    return NextResponse.json(status)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error({ err: error }, `Error fetching PR CI status: ${msg}`)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
