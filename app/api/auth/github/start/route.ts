/**
 * @fileType route
 * @domain kody
 * @pattern auth
 * @ai-summary Starts GitHub App user-login: redirects to GitHub's authorize page.
 *
 * GET /api/auth/github/start
 * Generates a CSRF `state`, stashes it in a short-lived httpOnly cookie, and
 * redirects the browser to GitHub. The callback verifies the cookie.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  isOAuthConfigured,
} from "@dashboard/lib/auth/github-oauth";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";

const STATE_COOKIE = "kody_oauth_state";
const STATE_TTL_S = 600; // 10 min — long enough to approve, short enough to be safe

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isOAuthConfigured()) {
    return NextResponse.json(
      { message: "GitHub App OAuth not configured on this deployment." },
      { status: 503 },
    );
  }

  const state = randomUUID();
  const redirectUri = `${getPublicBaseUrl(req)}/api/auth/github/callback`;
  const authorizeUrl = buildAuthorizeUrl(redirectUri, state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_S,
  });
  return res;
}
