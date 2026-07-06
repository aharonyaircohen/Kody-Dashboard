/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-status
 *
 * GET /api/kody/brain/status
 *
 * Read-only state of the per-user Brain Fly app for the connected repo.
 * Drives the BrainFlyStatusBar pill in the chat panel and the Runner page.
 *
 * Returns:
 *   { state: 'off' }                                    — no Fly token, no app yet.
 *   { state: 'running'|'suspended'|'stopped',
 *     app, url, machineId?, stored? }                   — live machine state.
 *
 * `stored` is the per-user record at
 * state-repo root `users/<login>/data/brain.json` (see `brain/store.ts`). It can
 * outlive the user's access to the app on Fly (token revoked, app moved
 * orgs, slug taken by another account) — in that case `state` is `off`
 * and `stored` is non-null, which the Runner page surfaces as an orphan
 * with a "Delete record" affordance.
 *
 * Provision lives in the chat route (POST /api/kody/chat/brain-fly) — the
 * first message provisions and resumes. This endpoint never mutates Fly.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { readBrainOverview } from "@dashboard/lib/brain/overview";
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

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    const overview = await readBrainOverview({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      githubToken: ctx.context.githubToken,
      orgSlug: ctx.context.flyOrgSlug,
      defaultRegion: ctx.context.flyDefaultRegion,
    });
    if (!overview.service) {
      return NextResponse.json({
        state: "off",
        stored: overview.stored,
        runtime: overview.runtime,
        drift: overview.drift,
      });
    }
    return NextResponse.json({
      app: overview.app,
      state: overview.state,
      url: overview.url,
      machineId: overview.machineId,
      machineImageRef: overview.machineImageRef,
      org: overview.org,
      reason: overview.reason,
      stored: overview.stored,
      runtime: overview.runtime,
      drift: overview.drift,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain status failed");
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearGitHubContext();
  }
}
