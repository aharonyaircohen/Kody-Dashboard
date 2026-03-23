/**
 * Kody Dashboard Session Management
 *
 * @fileType utility
 * @domain auth
 * @pattern oauth
 * @ai-summary Standalone GitHub identity session for the Kody Operations Dashboard.
 *   Uses a signed JWT cookie (kody-gh-session) independent of Payload CMS auth.
 *   Session payload: { login, avatar_url, githubId, encryptedGhToken?, iat, exp }
 *   When present, the GitHub access token is encrypted with AES-256-GCM at rest.
 */

import { SignJWT, jwtVerify } from 'jose'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'

export const KODY_SESSION_COOKIE = 'kody-gh-session'

/** 24-hour sessions — re-auth re-checks collaborator status */
const SESSION_TTL_SECONDS = 60 * 60 * 24

export interface KodyGitHubIdentity {
  login: string
  avatar_url: string
  githubId: number
  /** Decrypted GitHub access token — only present for sessions created with repo scope */
  ghToken?: string
}

interface KodySessionPayload {
  login: string
  avatar_url: string
  githubId: number
  /** Encrypted GitHub access token (base64: iv:ciphertext:authTag) */
  ght?: string
  iat: number
  exp: number
}

function getSecret(): Uint8Array {
  const secret = process.env.KODY_SESSION_SECRET
  if (!secret) throw new Error('KODY_SESSION_SECRET is required for kody session signing')
  // Prefix to namespace the key from Payload's own JWT usage
  return new TextEncoder().encode(`kody-gh-session:${secret}`)
}

/**
 * Derive a 256-bit AES key from KODY_SESSION_SECRET.
 * Uses SHA-256 hash so any length secret produces a valid 32-byte key.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.KODY_SESSION_SECRET
  if (!secret) throw new Error('KODY_SESSION_SECRET is required for token encryption')
  return createHash('sha256').update(`kody-token-encryption:${secret}`).digest()
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns base64-encoded string in format: iv:ciphertext:authTag
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const authTag = cipher.getAuthTag()

  return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`
}

/**
 * Decrypt a token encrypted with encryptToken().
 * Expects format: iv:ciphertext:authTag (all base64)
 */
export function decryptToken(encrypted: string): string {
  const key = getEncryptionKey()
  const parts = encrypted.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted token format')

  const iv = Buffer.from(parts[0], 'base64')
  const ciphertext = parts[1]
  const authTag = Buffer.from(parts[2], 'base64')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * Create a signed JWT and set it as an httpOnly cookie on the response.
 * Optionally includes an encrypted GitHub access token for per-user API calls.
 */
export async function createKodySession(
  res: NextResponse,
  identity: KodyGitHubIdentity,
  ghAccessToken?: string,
): Promise<void> {
  const secret = getSecret()
  const now = Math.floor(Date.now() / 1000)

  const jwtPayload: Record<string, unknown> = {
    login: identity.login,
    avatar_url: identity.avatar_url,
    githubId: identity.githubId,
  }

  // Encrypt and embed GitHub access token if provided
  if (ghAccessToken) {
    jwtPayload.ght = encryptToken(ghAccessToken)
  }

  const token = await new SignJWT(jwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(secret)

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }

  res.cookies.set(KODY_SESSION_COOKIE, token, cookieOptions)

  // Also set via Set-Cookie header for redirect responses (same pattern as oauth_cookies.ts)
  const sameSite = cookieOptions.secure ? 'Lax' : 'Lax'
  const parts = [
    `${KODY_SESSION_COOKIE}=${token}`,
    `Path=${cookieOptions.path}`,
    `Max-Age=${cookieOptions.maxAge}`,
    'HttpOnly',
    cookieOptions.secure ? 'Secure' : '',
    `SameSite=${sameSite}`,
  ].filter(Boolean)

  res.headers.append('Set-Cookie', parts.join('; '))
}

/**
 * Verify a raw session token string.
 * Used by both verifyKodySession (API routes) and verifyKodySessionToken (Server Components).
 * Decrypts the GitHub access token if present.
 */
async function verifyToken(token: string): Promise<KodyGitHubIdentity | null> {
  try {
    const secret = getSecret()
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    const p = payload as unknown as KodySessionPayload

    if (!p.login || !p.avatar_url || !p.githubId) return null

    const identity: KodyGitHubIdentity = {
      login: p.login,
      avatar_url: p.avatar_url,
      githubId: p.githubId,
    }

    // Decrypt GitHub access token if present (new sessions with repo scope)
    if (p.ght) {
      try {
        identity.ghToken = decryptToken(p.ght)
      } catch {
        // Token decryption failed — treat as legacy session (no user token)
      }
    }

    return identity
  } catch {
    return null
  }
}

/**
 * Verify the session cookie on an incoming NextRequest (API routes).
 * Returns the identity payload, or null if missing/invalid/expired.
 */
export async function verifyKodySession(req: NextRequest): Promise<KodyGitHubIdentity | null> {
  const token = req.cookies.get(KODY_SESSION_COOKIE)?.value
  if (!token) return null
  return verifyToken(token)
}

/**
 * Verify a raw session token string (for use in Server Components via next/headers cookies()).
 */
export async function verifyKodySessionToken(
  token: string | undefined,
): Promise<KodyGitHubIdentity | null> {
  if (!token) return null
  return verifyToken(token)
}

/**
 * Clear the session cookie (logout).
 */
export function clearKodySession(res: NextResponse): void {
  res.cookies.set(KODY_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}
