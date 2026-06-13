/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-external-login
 *
 * POST /api/kody/brain/login
 *
 * Returns the URL + API key needed to use this user's Brain on Fly from an
 * external Brain client. This is intentionally POST-only and no-store because
 * the API key is the login secret.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { readBrainApp, writeBrainApp } from "@dashboard/lib/brain/store";
import { logger } from "@dashboard/lib/logger";
import {
  brainAppName,
  provisionBrain,
  type PerfTier,
} from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";

export const runtime = "nodejs";

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
          "Brain on Fly needs a Fly Machines token. Set FLY_API_TOKEN or FLY_IO_TOKEN in the server env, or add FLY_API_TOKEN to the repo Secrets vault.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const body = (await req.json().catch(() => ({}))) as unknown;
  const override = parseAppNameOverride(body);
  let appName = override;

  if (!appName) {
    const stored = await readBrainApp(
      ctx.context.account,
      ctx.context.githubToken,
    ).catch(() => null);
    appName = stored?.appName ?? brainAppName(ctx.context.account);
  }

  try {
    const result = await provisionBrain({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      model: ctx.context.engineModel,
      githubToken: ctx.context.githubToken,
      allSecrets: ctx.context.allSecrets,
      perfTier: brainPerfFrom(req, ctx.context.perfTier),
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
        "brain login: record write failed (non-fatal)",
      );
    }

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
  }
}
