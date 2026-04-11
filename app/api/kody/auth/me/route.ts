/**
 * @fileType api-route
 * @domain kody
 * @pattern auth-api
 * @ai-summary Returns the current GitHub identity.
 *   With OAuth: reads from session cookie.
 *   Token-only auth: returns a placeholder identity when env token is configured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyKodySession } from '@dashboard/lib/auth/kody_session'

function getEnvToken(): string | null {
  return process.env.KODY_BOT_TOKEN || process.env.GITHUB_TOKEN || null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const identity = await verifyKodySession(req)

  // OAuth session found — return real identity
  if (identity) {
    return NextResponse.json({
      authenticated: true,
      user: {
        login: identity.login,
        avatar_url: identity.avatar_url,
        githubId: identity.githubId,
      },
    })
  }

  // Token-only auth — no session, but token is configured
  const token = getEnvToken()
  if (token) {
    return NextResponse.json({
      authenticated: true,
      user: {
        login: 'dashboard',
        avatar_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        githubId: 0,
      },
    })
  }

  // No token configured
  return NextResponse.json({ authenticated: false }, { status: 200 })
}
