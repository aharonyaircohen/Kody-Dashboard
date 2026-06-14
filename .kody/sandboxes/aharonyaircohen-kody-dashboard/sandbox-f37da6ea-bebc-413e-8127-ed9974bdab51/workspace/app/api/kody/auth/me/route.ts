/**
 * @fileType api-route
 * @domain kody
 * @pattern auth-api
 *
 * GET /api/kody/auth/me
 *
 * Returns the current GitHub identity from request headers (localStorage auth).
 */
import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth } from "@dashboard/lib/auth";
import { createUserOctokit } from "@dashboard/lib/github-client";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    const octokit = await createUserOctokit(headerAuth.token);
    try {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      return NextResponse.json({
        authenticated: true,
        user: {
          login: user.login,
          avatar_url: user.avatar_url,
          githubId: user.id,
        },
        owner: headerAuth.owner,
        repo: headerAuth.repo,
      });
    } catch {
      return NextResponse.json(
        { authenticated: false, error: "Invalid token" },
        { status: 401 },
      );
    }
  }

  return NextResponse.json({ authenticated: false }, { status: 200 });
}
