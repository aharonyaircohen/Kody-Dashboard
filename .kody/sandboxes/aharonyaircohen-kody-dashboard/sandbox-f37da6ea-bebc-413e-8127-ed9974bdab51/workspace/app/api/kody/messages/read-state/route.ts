/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern channels-read-state
 * @ai-summary Per-user channel read-state. GET returns `{ baseline, seen }`
 *   (channelNumber → last-opened ISO); POST `{ channelNumber }` stamps that
 *   channel as seen now. State lives in the *user's* private gist (same model
 *   as the inbox), so the Messages "new activity" badge syncs across devices.
 *
 *   Auth: user PAT (x-kody-token) with `gist` scope — without it the gist
 *   endpoints 404/403 and we surface a 400 hint, mirroring /api/kody/inbox.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import {
  readChannelsSeen,
  markChannelSeen,
} from "@dashboard/lib/messages/channels-seen-store";

const postSchema = z.object({
  channelNumber: z.number().int().positive(),
});

function gistScopeError(err: unknown): NextResponse | null {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number } | null)?.status;
  const looksLikeGist = /gist/i.test(msg);
  const scopeSignal =
    /(scope|forbidden|not\s*found|404|403)/i.test(msg) ||
    status === 403 ||
    status === 404;
  if (looksLikeGist && scopeSignal) {
    return NextResponse.json(
      {
        error: "gist_scope_missing",
        message:
          "PAT is missing the `gist` scope. Re-authenticate with gist access to track channel read-state.",
      },
      { status: 400 },
    );
  }
  return null;
}

export async function GET(req: NextRequest) {
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
    const manifest = await readChannelsSeen(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    return NextResponse.json(
      { baseline: manifest.baseline, seen: manifest.seen },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const scopeErr = gistScopeError(err);
    if (scopeErr) return scopeErr;
    return NextResponse.json(
      {
        error: "read_failed",
        message: err instanceof Error ? err.message : "read failed",
      },
      { status: 500 },
    );
  }
}

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

  const parsed = postSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation",
        message: "Invalid channelNumber",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const manifest = await markChannelSeen(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      parsed.data.channelNumber,
      new Date().toISOString(),
    );
    return NextResponse.json(
      { baseline: manifest.baseline, seen: manifest.seen },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const scopeErr = gistScopeError(err);
    if (scopeErr) return scopeErr;
    return NextResponse.json(
      {
        error: "write_failed",
        message: err instanceof Error ? err.message : "write failed",
      },
      { status: 500 },
    );
  }
}
