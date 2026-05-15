/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern inbox-mark-by-url
 * @ai-summary Mark every inbox entry whose `url` matches the provided value
 *   as read. Used when the user clicks a push notification — the service
 *   worker doesn't know the entry id, only the deep URL, so this is the
 *   bridge.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import { markByUrl } from "@dashboard/lib/inbox/gist-store";

const schema = z.object({ url: z.string().url().max(1024) });

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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "bad_json", message: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const manifest = await markByUrl(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      parsed.data.url,
    );
    return NextResponse.json(
      { entries: manifest.entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "mark_by_url_failed",
        message: err instanceof Error ? err.message : "mark-by-url failed",
      },
      { status: 500 },
    );
  }
}
