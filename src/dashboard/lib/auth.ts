/**
 * @fileType utility
 * @domain kody
 * @pattern auth
 * @ai-summary Dashboard authentication middleware (GitHub OAuth only).
 *   requireKodyAuth: GitHub OAuth session (any repo collaborator) — used for Kody API routes.
 *   getUserOctokit: Extract user's GitHub token from session and create per-request Octokit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyKodySession } from '@dashboard/lib/auth/kody_session'
import type { KodyGitHubIdentity } from '@dashboard/lib/auth/kody_session'
import { createUserOctokit } from '@dashboard/lib/github-client'
import { logger } from '@dashboard/lib/logger'
import type { Octokit } from '@octokit/rest'

/**
 * Require GitHub OAuth session for Kody API routes.
 * Returns null on success (authenticated), or a 401 NextResponse if not authenticated.
 */
export async function requireKodyAuth(req: NextRequest): Promise<null | NextResponse> {
  const identity = await verifyKodySession(req)
  if (!identity) {
    return NextResponse.json(
      { message: 'Not authenticated. Please log in to access the dashboard.' },
      { status: 401 },
    )
  }
  return null
}

/**
 * Get a per-request Octokit instance using the authenticated user's GitHub token.
 * Returns null if the session doesn't have a token (legacy sessions with read:user scope).
 * Callers should fall back to getOctokit() (bot token) when this returns null.
 */
export async function getUserOctokit(req: NextRequest): Promise<Octokit | null> {
  const identity = await verifyKodySession(req)
  if (!identity?.ghToken) return null
  return createUserOctokit(identity.ghToken)
}

/**
 * Verify that the supplied actorLogin matches the authenticated session.
 * Prevents actorLogin spoofing where a user could impersonate another user.
 */
export async function verifyActorLogin(
  req: NextRequest,
  suppliedLogin: string | undefined,
): Promise<{ identity: KodyGitHubIdentity } | NextResponse> {
  const authResult = await requireKodyAuth(req)
  if (authResult !== null) {
    return authResult
  }

  const identity = await verifyKodySession(req)
  if (!identity) {
    return NextResponse.json({ message: 'Authentication failed' }, { status: 401 })
  }

  if (!suppliedLogin) {
    return { identity }
  }

  const normalizedSupplied = suppliedLogin.toLowerCase()
  const normalizedIdentity = identity.login.toLowerCase()

  if (normalizedSupplied !== normalizedIdentity) {
    logger.warn(
      {
        suppliedLogin,
        authenticatedLogin: identity.login,
        path: req.nextUrl.pathname,
      },
      'ActorLogin mismatch - possible impersonation attempt',
    )
    return NextResponse.json(
      { message: 'Invalid actorLogin: does not match authenticated session' },
      { status: 403 },
    )
  }

  return { identity }
}
