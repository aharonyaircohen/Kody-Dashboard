/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern auth-api
 * @ai-summary API route for dashboard auth status (GitHub OAuth)
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyKodySession } from '@dashboard/lib/auth/kody_session'

export async function GET(req: NextRequest) {
  const identity = await verifyKodySession(req)
  return NextResponse.json({ authenticated: !!identity })
}
