/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-migrate-api
 * @ai-summary One-time legacy migration endpoint. POST moves the connected
 *   repo's `.kody/jobs/*` → `.kody/duties/*` and `.kody/workers/*` →
 *   `.kody/staff/*` (rewriting duty frontmatter `worker:` → `staff:`) so a
 *   repo built against the pre-rename engine works on ≥ 0.4.122. Idempotent
 *   — a repo with no legacy folders returns `noop: true`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { migrateRepoToDutiesStaff } from "@dashboard/lib/company/migrate";

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const actorLogin = (await req.json().catch(() => ({})))?.actorLogin as
      | string
      | undefined;

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message: "A signed-in GitHub token is required to migrate files.",
        },
        { status: 401 },
      );
    }

    const result = await migrateRepoToDutiesStaff(userOctokit);
    return NextResponse.json({ result });
  } catch (error: any) {
    console.error("[Company] Error migrating repo:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "migrate_failed",
        message: error?.message ?? "Failed to migrate",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
