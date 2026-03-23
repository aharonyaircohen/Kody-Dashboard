import { NextRequest, NextResponse } from "next/server";
import { validateOAuthState } from "@dashboard/lib/auth/oauth/state";
import { getPublicBaseUrl } from "@dashboard/lib/auth/oauth-url";
import { createKodySession } from "@dashboard/lib/auth/kody_session";
import { GITHUB_OWNER, GITHUB_REPO } from "@dashboard/lib/constants";
import { logger } from "@dashboard/lib/logger";

interface GitHubUserInfo {
  id: number;
  login: string;
  avatar_url: string;
  name?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = crypto.randomUUID();
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const res = new NextResponse(null, { status: 302 });

  // STEP 1: CSRF Protection
  const { valid: stateValid, returnTo } = validateOAuthState(req, res, state);
  if (!stateValid) {
    logger.warn(
      { correlationId, event: "github_oauth_invalid_state" },
      "Invalid OAuth state",
    );
    res.headers.set(
      "Location",
      new URL("/?error=invalid_state", req.url).toString(),
    );
    return res;
  }

  if (!code) {
    res.headers.set(
      "Location",
      new URL("/?error=missing_code", req.url).toString(),
    );
    return res;
  }

  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    logger.error(
      { correlationId, event: "github_oauth_not_configured" },
      "GitHub App env vars missing",
    );
    res.headers.set(
      "Location",
      new URL("/?error=not_configured", req.url).toString(),
    );
    return res;
  }

  // STEP 2: Exchange code for access token
  const baseUrl = getPublicBaseUrl(req);
  const callbackUrl = `${baseUrl}/api/oauth/github/callback`;

  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    },
  );

  if (!tokenResponse.ok) {
    logger.error(
      { correlationId, event: "github_oauth_token_exchange_failed" },
      "Token exchange failed",
    );
    res.headers.set(
      "Location",
      new URL("/?error=token_exchange_failed", req.url).toString(),
    );
    return res;
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token || tokenData.error) {
    logger.warn(
      { correlationId, event: "github_oauth_no_token", error: tokenData.error },
      "No access token in response",
    );
    res.headers.set(
      "Location",
      new URL("/?error=token_exchange_failed", req.url).toString(),
    );
    return res;
  }

  const userAccessToken = tokenData.access_token;

  // STEP 3: Fetch GitHub user profile
  const userinfoResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!userinfoResponse.ok) {
    logger.error(
      { correlationId, event: "github_oauth_userinfo_failed" },
      "User info request failed",
    );
    res.headers.set(
      "Location",
      new URL("/?error=userinfo_failed", req.url).toString(),
    );
    return res;
  }

  const userinfo = (await userinfoResponse.json()) as GitHubUserInfo;
  if (!userinfo.id || !userinfo.login) {
    res.headers.set(
      "Location",
      new URL("/?error=invalid_userinfo", req.url).toString(),
    );
    return res;
  }

  // STEP 4: Verify user is a repo collaborator
  const botToken = process.env.KODY_BOT_TOKEN || process.env.GITHUB_TOKEN;
  if (!botToken) {
    logger.error(
      { correlationId, event: "github_oauth_no_bot_token" },
      "No KODY_BOT_TOKEN or GITHUB_TOKEN for collaborator check",
    );
    res.headers.set(
      "Location",
      new URL("/?error=not_configured", req.url).toString(),
    );
    return res;
  }

  try {
    const collabResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/collaborators/${userinfo.login}`,
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (collabResponse.status !== 204) {
      logger.warn(
        {
          correlationId,
          event: "github_oauth_not_collaborator",
          login: userinfo.login,
          status: collabResponse.status,
        },
        "GitHub user is not a repo collaborator",
      );
      res.headers.set(
        "Location",
        new URL("/?error=not_collaborator", req.url).toString(),
      );
      return res;
    }
  } catch (err) {
    logger.error(
      { correlationId, event: "github_oauth_collaborator_check_failed", err },
      "Collaborator check failed",
    );
    res.headers.set(
      "Location",
      new URL("/?error=collaborator_check_failed", req.url).toString(),
    );
    return res;
  }

  // STEP 5: Issue session cookie
  await createKodySession(
    res,
    {
      login: userinfo.login,
      avatar_url: userinfo.avatar_url,
      githubId: userinfo.id,
    },
    userAccessToken,
  );

  logger.info(
    { correlationId, event: "github_oauth_success", login: userinfo.login },
    "GitHub OAuth login successful",
  );

  res.headers.set("Location", returnTo || "/");
  return res;
}
