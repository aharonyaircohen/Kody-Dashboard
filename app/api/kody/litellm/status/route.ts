/**
 * @fileType api-endpoint
 * @domain runners
 * @pattern litellm-fly-status
 *
 * GET /api/kody/litellm/status
 *
 * Read-only state of the shared always-on LiteLLM proxy Fly app
 * (`kody-litellm`). Drives the LiteLLM card in Settings → Fly.
 *
 * Returns:
 *   { state: 'off' }                        — no Fly token, or app not deployed.
 *   { state: 'running'|'suspended'|'stopped',
 *     app, machineCount }                    — live state.
 *
 * Never mutates Fly. The app is deployed out-of-band via `fly deploy` in
 * kody2/litellm-server — the dashboard only reports whether it's up. Gated
 * on Fly being configured (no token → "off"), since GitHub Actions is the
 * default/fallback path. See project_fly_optional_gh_default.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { litellmStatus } from "@dashboard/lib/runners/litellm-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    // No Fly token in the vault — Fly isn't configured, so there's nothing
    // to report. GitHub Actions remains the default path.
    return NextResponse.json({ state: "off" });
  }

  try {
    const result = await litellmStatus({ flyToken: ctx.context.flyToken });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, owner: ctx.context.owner }, "litellm status failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
