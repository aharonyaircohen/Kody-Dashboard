/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-provision
 *
 * POST /api/kody/brain/provision
 *
 * Idempotent provision of the per-user Brain Fly app. Drives the
 * Settings "Brain on Fly" toggle — the user flips it ON and we create
 * (or reuse) the app + machine. Returns the same shape as the chat
 * route's internal provisionBrain call.
 *
 * Auth: requireKodyAuth. The Fly token comes from `ctx.context.flyToken`,
 * which is resolved in `fly-context.ts` as: env `FLY_API_TOKEN` →
 * env `FLY_IO_TOKEN` → repo vault `FLY_API_TOKEN`. Single source, no
 * fallback dance, no retry loop.
 *
 * App name resolution (in order):
 *   1. `appName` in the request body — explicit user override from the
 *      Runner card's "Fly app name" field.
 *   2. The `appName` in the storage record (`users/<login>/data/
 *      brain.json`) — what we used last time, so the chat route and
 *      the Runner stay in sync.
 *   3. The derived `kody-brain-<github-login>` name.
 *
 * On success, the storage record is updated to reflect the actual
 * name (and the org Fly reports). On failure, Fly's message surfaces
 * verbatim — no swallowing, no retry.
 *
 * The chat route /api/kody/chat/brain-fly still calls provisionBrain
 * directly as a safety net (idempotent), so this route is purely for
 * the user-initiated path from Settings.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { readBrainApp, writeBrainApp } from "@dashboard/lib/brain/store";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import {
  brainAppName,
  provisionBrain,
  type PerfTier,
} from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";

export const runtime = "nodejs";

/** Brain has its OWN size, set independently of the per-user task-run speed
 * (`x-kody-fly-perf`). The `x-kody-brain-perf` header carries it; absent →
 * fall back to the shared tier, then the server default. */
function brainPerfFrom(
  req: NextRequest,
  fallback?: PerfTier,
): PerfTier | undefined {
  const raw = req.headers.get("x-kody-brain-perf");
  return raw === "low" || raw === "medium" || raw === "high" ? raw : fallback;
}

function brainSuspendOnIdleFrom(req: NextRequest): boolean | undefined {
  const raw = req.headers.get("x-kody-brain-suspension");
  if (raw === "never") return false;
  if (raw === "auto") return true;
  return undefined;
}

/** Parse and validate the optional `appName` from the request body. */
function parseAppNameOverride(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const v = (body as { appName?: unknown }).appName;
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  // Fly app names must match ^[a-z0-9][a-z0-9-]*$ and be ≤ 30 chars.
  if (trimmed.length === 0) return undefined;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return undefined;
  if (trimmed.length > 30) return undefined;
  return trimmed;
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Brain on Fly needs a Fly Machines token. Set FLY_API_TOKEN or FLY_IO_TOKEN in the server env, or add FLY_API_TOKEN to the repo Secrets vault.",
      },
      { status: 400 },
    );
  }

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    // Parse the optional explicit override from the UI.
    const body = (await req.json().catch(() => ({}))) as unknown;
    const override = parseAppNameOverride(body);

    // Otherwise, prefer the previously-stored name so the Runner and
    // chat route stay in sync. Fall back to the derived default.
    let appName: string;
    if (override) {
      appName = override;
    } else {
      const stored = await readBrainApp(
        ctx.context.account,
        ctx.context.githubToken,
      ).catch(() => null);
      appName = stored?.appName ?? brainAppName(ctx.context.account);
    }

    const result = await provisionBrain({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      model: ctx.context.engineModel,
      githubToken: ctx.context.githubToken,
      allSecrets: ctx.context.allSecrets,
      perfTier: brainPerfFrom(req, ctx.context.perfTier),
      suspendOnIdle: brainSuspendOnIdleFrom(req),
      appNameOverride: appName,
    });
    try {
      await writeBrainApp(ctx.context.account, ctx.context.githubToken, {
        version: 1,
        appName: result.app,
        orgSlug: result.org,
        createdAt: new Date().toISOString(),
      });
    } catch (writeErr) {
      logger.warn(
        { err: writeErr, owner: ctx.context.owner, app: result.app },
        "brain provision: record write failed (non-fatal)",
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain provision failed");
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearGitHubContext();
  }
}
