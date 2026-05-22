/**
 * @fileType route
 * @domain kody
 * @pattern auth
 * @ai-summary Completes GitHub App user-login: code → user token + identity.
 *
 * GET /api/auth/github/callback?code=...&state=...
 * Verifies the CSRF `state` cookie, exchanges the code for a user access
 * token, resolves the user via GET /user, then redirects to the client
 * completion page with the token + identity in the URL fragment (never sent
 * to a server). The client stores it the same way the pasted PAT was stored.
 */
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@dashboard/lib/auth/github-oauth";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";
import { createUserOctokit } from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";

const STATE_COOKIE = "kody_oauth_state";

function fail(base: string, reason: string): NextResponse {
  const res = NextResponse.redirect(
    `${base}/?oauth_error=${encodeURIComponent(reason)}`,
  );
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = getPublicBaseUrl(req);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state) return fail(base, "missing_code");
  if (!cookieState || cookieState !== state) return fail(base, "bad_state");

  try {
    const redirectUri = `${base}/api/auth/github/callback`;
    const { accessToken } = await exchangeCodeForToken(code, redirectUri);

    const { data: user } = await createUserOctokit(
      accessToken,
    ).users.getAuthenticated();

    // Hand token + identity to the client via the URL fragment (not sent to
    // any server); the completion page persists it to localStorage.
    const fragment = new URLSearchParams({
      token: accessToken,
      login: user.login,
      id: String(user.id),
      avatar: user.avatar_url,
    }).toString();

    const res = NextResponse.redirect(`${base}/auth/complete#${fragment}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    logger.warn({ err }, "github oauth callback failed");
    return fail(base, "exchange_failed");
  }
}
