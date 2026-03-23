/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern health-check
 * @ai-summary Health check for the remote dev agent — returns online/offline status
 *
 * Returns 404 if the actor is not configured in REMOTE_DEV_USERS.
 * Uses a 3s timeout to keep the UI responsive.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireKodyAuth } from '@dashboard/lib/auth'
import { getRemoteConfig } from '@dashboard/lib/remote-config'
import { logger } from '@dashboard/lib/logger'

export const runtime = 'nodejs'

const STATUS_TIMEOUT_MS = 3_000

export async function GET(req: NextRequest) {
  try {
    const authError = await requireKodyAuth(req)
    if (authError) return authError

    const { searchParams } = new URL(req.url)
    const actorLogin = searchParams.get('actorLogin')

    if (!actorLogin) {
      return NextResponse.json({ error: 'actorLogin query param is required' }, { status: 400 })
    }

    const remoteConfig = getRemoteConfig(actorLogin)
    if (!remoteConfig) {
      // Return 200 with configured: false instead of 404 to avoid console errors
      return NextResponse.json({ configured: false, online: false })
    }

    const healthUrl = `${remoteConfig.funnelUrl.replace(/\/$/, '')}/health`

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS)

      let online = false
      try {
        const res = await fetch(healthUrl, { signal: controller.signal })
        online = res.ok
      } finally {
        clearTimeout(timeoutId)
      }

      return NextResponse.json({
        configured: true,
        online,
        funnelUrl: remoteConfig.funnelUrl,
      })
    } catch {
      return NextResponse.json({
        configured: true,
        online: false,
        funnelUrl: remoteConfig.funnelUrl,
      })
    }
  } catch (error) {
    logger.error({ err: error }, 'Remote status route error')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
