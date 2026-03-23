import { NextRequest, NextResponse } from "next/server";
import { storeOAuthState } from "@dashboard/lib/auth/oauth/state";
import { sanitizeReturnTo } from "@dashboard/lib/auth/oauth/sanitize";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const returnTo = sanitizeReturnTo(
    req.nextUrl.searchParams.get("returnTo") ?? "/",
  );

  const baseUrl = getPublicBaseUrl(req);
  // TEMP: hardcode for debug
  const callbackUrl = `https://kody-aguy.vercel.app/api/oauth/github/callback`;

  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub App not configured" },
      { status: 503 },
    );
  }

  const authUrl = new URL(GITHUB_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);

  const res = NextResponse.redirect(authUrl);
  const state = await storeOAuthState(res, returnTo);

  authUrl.searchParams.set("state", state);
  res.headers.set("Location", authUrl.toString());

  return res;
}
