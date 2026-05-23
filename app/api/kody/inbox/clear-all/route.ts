/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern inbox-clear-all
 * @ai-summary POST removes every entry from the user's per-repo inbox gist,
 *   leaving an empty manifest. No-op if the inbox is already empty.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import { clearInbox } from "@dashboard/lib/inbox/gist-store";

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
    const manifest = await clearInbox(
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
        error: "clear_all_failed",
        message: err instanceof Error ? err.message : "clear-all failed",
      },
      { status: 500 },
    );
  }
}
