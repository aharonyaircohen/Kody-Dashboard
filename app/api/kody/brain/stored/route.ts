/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-stored-record
 *
 * GET /api/kody/brain/stored   — read the user's stored brain record.
 * DELETE /api/kody/brain/stored — clear the stored record (orphan recovery).
 *
 * The stored record at `users/<login>/data/brain.json` is the
 * dashboard's record of "here is the Fly app we believe this user has."
 * It can outlive the user's access to the app on Fly (token revoked, app
 * moved to a different org, slug taken by another account, etc.), in
 * which case the Runner page shows it as an "orphan" and the user can
 * DELETE this record to clear it before re-provisioning.
 *
 * DELETE is a metadata-only operation — it does NOT touch Fly. Use
 * POST /api/kody/brain/destroy for the actual Fly teardown.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import {
  clearBrainApp,
  readBrainApp,
  type BrainAppFile,
} from "@dashboard/lib/brain/store";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  // The storage layer reads owner/repo from the request-scoped github
  // context (`getOwner()` / `getRepo()`), not from the fly context we
  // just resolved. Set it explicitly so the read targets the right repo.
  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    const record = await readBrainApp(
      ctx.context.account,
      ctx.context.githubToken,
    );
    return NextResponse.json({ stored: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, owner: ctx.context.owner },
      "brain stored: read failed",
    );
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    await clearBrainApp(ctx.context.account, ctx.context.githubToken);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, owner: ctx.context.owner },
      "brain stored: clear failed",
    );
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearGitHubContext();
  }
}

export type { BrainAppFile };
