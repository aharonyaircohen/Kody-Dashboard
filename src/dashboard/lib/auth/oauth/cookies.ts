import type { NextRequest, NextResponse } from 'next/server'
import { STATE_COOKIE_OPTIONS } from './constants'

export function readCookie(req: NextRequest, name: string): string | undefined {
  return req.cookies.get(name)?.value
}

export function deleteCookie(res: NextResponse, name: string): void {
  res.cookies.delete(name)
}

export function setShortLivedCookie(res: NextResponse, name: string, value: string): void {
  res.cookies.set(name, value, STATE_COOKIE_OPTIONS)
}
