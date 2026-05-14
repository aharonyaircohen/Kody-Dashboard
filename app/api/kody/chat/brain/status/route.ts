/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern brain-status
 *
 * GET /api/kody/chat/brain/status
 *
 * Tells the client whether the deployment has a server-side Brain configured
 * via `BRAIN_CHAT_URL` + `BRAIN_CHAT_API_KEY` env vars. The chat dropdown uses
 * this to surface the "Kody Brain" entry even when the user has not stored
 * URL + API key in their localStorage. Pairs with per-user config from
 * `getStoredBrainConfig()` — either source enables the entry.
 *
 * Auth: requireKodyAuth so we don't leak deployment shape to anonymous
 * callers. Returns only a boolean — no URL or key material.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireKodyAuth } from '@dashboard/lib/auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const serverConfigured = Boolean(
    process.env.BRAIN_CHAT_URL?.trim() &&
      process.env.BRAIN_CHAT_API_KEY?.trim(),
  )

  return NextResponse.json({ serverConfigured })
}
