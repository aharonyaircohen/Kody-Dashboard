/**
 * @fileType api-route
 * @domain kody
 * @pattern auth-api
 * @ai-summary Clears the Kody GitHub session cookie (logout). Only the
 *   POST path is used — the GET-redirect variant pointed at the deleted
 *   GitHub OAuth start endpoint and has been removed along with it.
 */

import { NextRequest, NextResponse } from "next/server";
import { clearKodySession } from "@dashboard/lib/auth/kody_session";

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.json({ success: true });
  clearKodySession(res);
  return res;
}
