/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern inbox-list-append
 * @ai-summary Inbox list + append endpoint. GET returns the current
 *   per-repo inbox manifest (entries newest-first), POST appends new
 *   entries (deduped by id, FIFO-capped at INBOX_MAX_ENTRIES).
 *
 *   Auth uses the user's PAT (x-kody-token) — the inbox lives in the
 *   *user's* gist, not in dashboard infra. PAT must have `gist` scope;
 *   without it the gists endpoints return 404/403 and the route surfaces
 *   that as a 400 with a hint.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import { appendInboxEntries, readInbox } from "@dashboard/lib/inbox/gist-store";
import type { InboxEntry, InboxSource } from "@dashboard/lib/inbox/types";

const SOURCES = [
  "mention",
  "comment",
  "review_requested",
  "assigned",
  "team_mention",
  "subscribed",
  "other",
] as const satisfies readonly InboxSource[];

const entrySchema = z.object({
  id: z.string().min(1).max(256),
  source: z.enum(SOURCES),
  repoFullName: z.string().min(3).max(140),
  threadType: z.string().min(1).max(40),
  title: z.string().max(280),
  snippet: z.string().max(400),
  author: z.string().max(120).optional(),
  url: z.string().url().max(1024),
  sentAt: z.string().min(1).max(40),
  readAt: z.string().nullable(),
  ctoAction: z.string().max(40).optional(),
  ctoCommand: z.string().max(300).optional(),
  ctoStaff: z.string().max(40).optional(),
}) satisfies z.ZodType<InboxEntry>;

const appendSchema = z.object({
  entries: z.array(entrySchema).min(1).max(50),
});

function gistScopeError(err: unknown): NextResponse | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/gist/i.test(msg) && /(scope|forbidden|404|403)/i.test(msg)) {
    return NextResponse.json(
      {
        error: "gist_scope_missing",
        message:
          "PAT is missing the `gist` scope. Re-authenticate with gist access to use the inbox.",
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
    const { manifest, gistId } = await readInbox(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    return NextResponse.json(
      { gistId, entries: manifest.entries },
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

  const parsed = appendSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation",
        message: "Invalid entries payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const { manifest, added } = await appendInboxEntries(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      parsed.data.entries,
    );
    return NextResponse.json(
      { added, entries: manifest.entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const scopeErr = gistScopeError(err);
    if (scopeErr) return scopeErr;
    return NextResponse.json(
      {
        error: "append_failed",
        message: err instanceof Error ? err.message : "append failed",
      },
      { status: 500 },
    );
  }
}
