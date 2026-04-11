/**
 * @fileType utility
 * @domain kody
 * @pattern auth
 * @ai-summary Token-based authentication for the Kody Operations Dashboard.
 *   Uses GITHUB_TOKEN / KODY_BOT_TOKEN env var for all API operations.
 *   OAuth session is optional — falls back to env token when no session exists.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyKodySession } from '@dashboard/lib/auth/kody_session'
import { createUserOctokit } from '@dashboard/lib/github-client'
import { logger } from '@dashboard/lib/logger'
import type { Octokit } from '@octokit/rest'

function getEnvToken(): string | null {
  return process.env.KODY_BOT_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_PAT || null
}

/**
 * Require GitHub API token (env var) for Kody API routes.
 * OAuth session is optional — this check only verifies the env token exists.
 * Returns null on success, or a 503 NextResponse if no token is configured.
 */
export async function requireKodyAuth(_req: NextRequest): Promise<null | NextResponse> {
  const token = getEnvToken()
  if (!token) {
    return NextResponse.json(
      { message: 'GitHub token not configured. Set GITHUB_TOKEN, KODY_BOT_TOKEN, or GH_PAT.' },
      { status: 503 },
    )
  }
  return null
}

/**
 * Get a per-request Octokit instance.
 *
 * Priority:
 * 1. User's own GitHub token from OAuth session (if logged in with repo scope)
 * 2. KODY_BOT_TOKEN / GITHUB_TOKEN env var (token-only auth)
 *
 * Callers should always prefer this over getOctokit() when the route is authenticated,
 * so write operations are attributed to the actual user rather than the bot account.
 */
export async function getUserOctokit(req: NextRequest): Promise<Octokit | null> {
  const identity = await verifyKodySession(req)
  if (identity?.ghToken) {
    return createUserOctokit(identity.ghToken)
  }
  // Token-only auth — use env token
  const token = getEnvToken()
  if (!token) return null
  return createUserOctokit(token)
}

/**
 * Verify that the supplied actorLogin matches the authenticated session.
 *
 * With OAuth: requires session + exact login match (prevents impersonation)
 * Token-only:  accepts any actorLogin since there's no session to impersonate
 */
export async function verifyActorLogin(
  req: NextRequest,
  suppliedLogin: string | undefined,
): Promise<{ identity: { login: string; avatar_url: string; githubId: number } } | NextResponse> {
  const authError = await requireKodyAuth(req)
  if (authError !== null) {
    return authError
  }

  const identity = await verifyKodySession(req)

  // Token-only auth (no OAuth session) — actorLogin check is skipped
  // since there's no session identity to impersonate
  if (!identity) {
    const token = getEnvToken()
    if (token) {
      logger.info(
        { actorLogin: suppliedLogin, path: req.nextUrl.pathname },
        'Token-only auth: actorLogin verification skipped',
      )
      // Return a placeholder identity — callers use actorLogin from request body
      return {
        identity: {
          login: suppliedLogin || 'token-user',
          avatar_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
          githubId: 0,
        },
      }
    }
    return NextResponse.json({ message: 'No auth token available' }, { status: 401 })
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
      'ActorLogin mismatch — possible impersonation attempt',
    )
    return NextResponse.json(
      { message: 'Invalid actorLogin: does not match authenticated session' },
      { status: 403 },
    )
  }

  return { identity }
}
