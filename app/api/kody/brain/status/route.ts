/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-status
 *
 * GET /api/kody/brain/status
 *
 * Reports the current state of the per-user Brain app: running,
 * suspended, stopped, or off (no app yet). Used by the Settings UI to
 * render the status pill next to the Brain card.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireKodyAuth } from '@dashboard/lib/auth'
import { logger } from '@dashboard/lib/logger'
import { resolveFlyContext } from '@dashboard/lib/runners/fly-context'
import { brainStatus } from '@dashboard/lib/runners/brain-fly'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const ctx = await resolveFlyContext(req)
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  }
  if (!ctx.context.flyToken) {
    // No Fly token = Brain has never been provisioned for this user.
    return NextResponse.json({ state: 'off' })
  }

  try {
    const result = await brainStatus({
      flyToken: ctx.context.flyToken,
      owner: ctx.context.owner,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, owner: ctx.context.owner }, 'brain status failed')
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
