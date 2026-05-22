/**
 * @fileType utility
 * @domain kody
 * @pattern auth
 * @ai-summary GitHub App user-login (OAuth) — authorize URL + code exchange.
 *
 * The "Sign in with GitHub" flow uses the App's user-to-server OAuth: we send
 * the user to GitHub, they approve, GitHub redirects back with a `code`, and
 * we exchange it for a user access token. That token identifies the user and
 * is used as their `x-kody-token` (same slot the pasted PAT used to fill), so
 * the rest of the dashboard's auth is unchanged.
 *
 * Token expiry: this assumes the App has "Expire user authorization tokens"
 * turned OFF, so the access token is long-lived like the PAT it replaces and
 * there is no refresh-token dance. If you turn expiry on, this needs to also
 * persist + rotate the refresh token.
 */
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** True when the OAuth half of the App is configured. */
export function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET,
  );
}

/**
 * Build the GitHub authorize URL to redirect the user to. GitHub App OAuth
 * takes no `scope` param — permissions come from the App's declared
 * permissions, not the URL.
 */
export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  if (!clientId) throw new Error("GITHUB_APP_CLIENT_ID not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface OAuthToken {
  accessToken: string;
  /** Present only when token expiry is enabled on the App. */
  refreshToken?: string;
}

/**
 * Exchange an authorization `code` for a user access token. Throws with the
 * GitHub-reported reason on failure (e.g. bad/expired code).
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<OAuthToken> {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GitHub App OAuth not configured (client id/secret missing)");
  }

  const res = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error || !data.access_token) {
    throw new Error(
      `GitHub token exchange rejected: ${data.error_description || data.error || "no access_token"}`,
    );
  }

  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
