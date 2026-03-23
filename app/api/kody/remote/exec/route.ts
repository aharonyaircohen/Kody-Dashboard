/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern proxy-endpoint
 * @ai-summary Proxy endpoint that forwards exec/read/write/ls actions to the remote dev agent
 *
 * Returns 404 if the actor is not configured in REMOTE_DEV_USERS.
 * Returns 502 on agent connection failure, 504 on timeout.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyActorLogin } from '@dashboard/lib/auth'
import { getRemoteConfig } from '@dashboard/lib/remote-config'
import { logger } from '@dashboard/lib/logger'

export const runtime = 'nodejs'

// 60 second proxy timeout (agent exec can take up to 30s)
const PROXY_TIMEOUT_MS = 60_000

type RemoteAction = 'exec' | 'read' | 'write' | 'ls'

interface RemoteExecRequest {
  actorLogin: string
  action: RemoteAction
  payload: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  let verifiedLogin: string | undefined

  try {
    // Parse body first to get actorLogin for verification
    const body = (await req.json()) as Partial<RemoteExecRequest>
    const { actorLogin, action, payload: actionPayload = {} } = body

    // Authenticate and verify actorLogin matches session (prevents impersonation)
    const authResult = await verifyActorLogin(req, actorLogin)
    if ('status' in authResult) {
      return authResult // Return the 401/403 response
    }

    const { identity } = authResult

    // Use verified identity for all further operations
    verifiedLogin = identity.login

    if (!action || !['exec', 'read', 'write', 'ls'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be one of: exec, read, write, ls' },
        { status: 400 },
      )
    }

    // Look up user config using verified identity
    const remoteConfig = getRemoteConfig(verifiedLogin)
    if (!remoteConfig) {
      return NextResponse.json(
        { error: 'Remote dev environment not configured for this user' },
        { status: 404 },
      )
    }

    const agentUrl = `${remoteConfig.funnelUrl.replace(/\/$/, '')}/${action}`

    logger.info({ actorLogin: verifiedLogin, action, agentUrl }, 'Proxying to remote agent')

    // Proxy to the remote agent with timeout
    let agentResponse: Response
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)

      try {
        agentResponse = await fetch(agentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${remoteConfig.key}`,
          },
          body: JSON.stringify(actionPayload),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.warn({ actorLogin: verifiedLogin, action }, 'Remote agent request timed out')
        return NextResponse.json({ error: 'Remote agent timed out after 60s' }, { status: 504 })
      }
      logger.error({ err, actorLogin: verifiedLogin, action }, 'Failed to connect to remote agent')
      return NextResponse.json({ error: 'Failed to connect to remote agent' }, { status: 502 })
    }

    const data = await agentResponse.json()

    if (!agentResponse.ok) {
      return NextResponse.json(data, { status: agentResponse.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    logger.error({ err: error, actorLogin: verifiedLogin ?? 'unknown' }, 'Remote exec route error')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
