/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern inbox-mark-all
 * @ai-summary POST marks every unread entry in the user's per-repo inbox as
 *   read, stamping `readAt` with `now`. No-op if everything is already read.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getRequestAuth, getUserOctokit } from "@dashboard/lib/auth";
import { markAllRead } from "@dashboard/lib/inbox/gist-store";

export async function POST(req: NextRequest) {
  const authErr = await requireKodyAuth(req);
  if (authErr) return authErr;
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      { error: "auth_required", message: "Missing repo auth headers" },
      { status: 401 },
    );
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "auth_required", message: "No octokit instance" },
      { status: 401 },
    );
  }
  try {
    const manifest = await markAllRead(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    return NextResponse.json(
      { entries: manifest.entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "read_all_failed",
        message: err instanceof Error ? err.message : "mark-all failed",
      },
      { status: 500 },
    );
  }
}
