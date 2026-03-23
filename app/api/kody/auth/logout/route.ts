/**
 * @fileType api-route
 * @domain kody
 * @pattern auth-api
 * @ai-summary Clears the Kody GitHub session cookie (logout).
 *   After clearing, redirect to GitHub OAuth to re-authenticate.
 */

import { NextRequest, NextResponse } from "next/server";
import { clearKodySession } from "@dashboard/lib/auth/kody_session";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.json({ success: true });
  clearKodySession(res);
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const baseUrl = getPublicBaseUrl(req);
  const res = new NextResponse(null, { status: 302 });
  clearKodySession(res);
  res.headers.set("Location", `${baseUrl}/api/oauth/github?returnTo=/`);
  return res;
}
