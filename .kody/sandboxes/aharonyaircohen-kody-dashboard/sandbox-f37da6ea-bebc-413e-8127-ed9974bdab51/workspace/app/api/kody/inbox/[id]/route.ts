/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern inbox-entry-mutate
 * @ai-summary Per-entry inbox mutations. PATCH sets/clears readAt (idempotent),
 *   DELETE removes the entry. Both run through `mutateInbox`'s per-user mutex
 *   so concurrent calls from multiple tabs can't lose updates.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import { deleteEntry, markEntryRead } from "@dashboard/lib/inbox/gist-store";

const patchSchema = z.object({
  readAt: z.union([z.string(), z.null()]),
});

async function resolveAuth(req: NextRequest) {
  const authErr = await requireKodyAuth(req);
  if (authErr) return { error: authErr };
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return {
      error: NextResponse.json(
        { error: "auth_required", message: "Missing repo auth headers" },
        { status: 401 },
      ),
    };
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return {
      error: NextResponse.json(
        { error: "auth_required", message: "No octokit instance" },
        { status: 401 },
      ),
    };
  }
  return { headerAuth, octokit };
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveAuth(req);
  if ("error" in ctx) return ctx.error;
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: "validation", message: "Missing id" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "bad_json", message: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const manifest = await markEntryRead(
      ctx.octokit,
      ctx.headerAuth.owner,
      ctx.headerAuth.repo,
      id,
      parsed.data.readAt,
    );
    return NextResponse.json(
      { entries: manifest.entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "patch_failed",
        message: err instanceof Error ? err.message : "patch failed",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveAuth(req);
  if ("error" in ctx) return ctx.error;
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: "validation", message: "Missing id" },
      { status: 400 },
    );
  }

  try {
    const manifest = await deleteEntry(
      ctx.octokit,
      ctx.headerAuth.owner,
      ctx.headerAuth.repo,
      id,
    );
    return NextResponse.json(
      { entries: manifest.entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "delete_failed",
        message: err instanceof Error ? err.message : "delete failed",
      },
      { status: 500 },
    );
  }
}
