/**
 * @fileType api-endpoint
 * @domain runners
 * @pattern warm-pool-status
 *
 * GET /api/kody/pool/status
 *
 * Read-only counts from the warm-pool owner (kody pool-serve on kody-litellm).
 * Drives the pool line on the Settings → LiteLLM card.
 *
 * Returns { status: PoolStatus } when reachable, or { status: null } when the
 * pool is unconfigured/unreachable (no KODY_MASTER_KEY, owner down). Never
 * errors — the pool is an accelerator, GitHub Actions is the fallback.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { fetchPoolStatus } from "@dashboard/lib/runners/pool-client";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const status = await fetchPoolStatus();
  return NextResponse.json({ status });
}
