/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-external-login
 *
 * POST /api/kody/brain/login
 *
 * Returns the URL + API key needed to use this user's Repo Brain on Fly from an
 * external Brain client. This is intentionally POST-only and no-store because
 * the API key is the login secret.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { manageBrainServer } from "@dashboard/lib/brain/server-commands";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import type { PerfTier } from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import { requestOrigin } from "@dashboard/lib/request-origin";

export const runtime = "nodejs";
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

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

function parseAppNameOverride(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const v = (body as { appName?: unknown }).appName;
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
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
    return NextResponse.json(
      { error: ctx.error },
      { status: ctx.status, headers: NO_STORE_HEADERS },
    );
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Repo Brain on Fly needs a Fly Machines token. Set FLY_API_TOKEN or FLY_IO_TOKEN in the server env, or add FLY_API_TOKEN to the repo Secrets vault.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
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
    const body = (await req.json().catch(() => ({}))) as unknown;
    const override = parseAppNameOverride(body);
    const result = await manageBrainServer({
      command: "provision",
      context: ctx.context,
      perfTier: brainPerfFrom(req, ctx.context.perfTier),
      suspendOnIdle: brainSuspendOnIdleFrom(req),
      dashboardUrl: requestOrigin(req),
      appNameOverride: override,
    });

    return NextResponse.json(
      {
        app: result.app,
        url: result.url,
        apiKey: result.apiKey,
        machineId: result.machineId,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "brain login failed");
    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}
