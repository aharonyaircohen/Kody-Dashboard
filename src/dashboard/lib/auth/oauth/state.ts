import type { NextRequest, NextResponse } from 'next/server'
import { generateNonce } from './nonce'
import { readCookie, deleteCookie, setShortLivedCookie } from './cookies'
import { sanitizeReturnTo } from './sanitize'

const STATE_COOKIE = 'oauth_state'
const RETURN_TO_COOKIE = 'oauth_return_to'

export async function storeOAuthState(res: NextResponse, returnTo: string): Promise<string> {
  const sanitizedReturnTo = sanitizeReturnTo(returnTo)
  setShortLivedCookie(res, RETURN_TO_COOKIE, sanitizedReturnTo)

  const state = await generateNonce()
  setShortLivedCookie(res, STATE_COOKIE, state)

  return state
}

export function validateOAuthState(
  req: NextRequest,
  res: NextResponse,
  state: string | null,
): { valid: boolean; returnTo: string } {
  const storedState = readCookie(req, STATE_COOKIE)

  const valid = storedState === state && state !== null && state !== undefined

  const returnTo = valid ? readCookie(req, RETURN_TO_COOKIE) || '/' : '/'

  deleteCookie(res, STATE_COOKIE)
  deleteCookie(res, RETURN_TO_COOKIE)

  return { valid, returnTo }
}
