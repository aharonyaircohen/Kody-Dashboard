/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern action-state
 *
 * GET /api/kody/action/state/:runId
 * Dashboard fetches the current state of an action.
 */

import { NextRequest, NextResponse } from "next/server";
import { getActionState } from "@dashboard/lib/kody-store/action-state";
import { requireKodyAuth } from "@dashboard/lib/auth";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authError = await requireKodyAuth(_req);
  if (authError) return authError;

  const { runId } = await params;
  const state = await getActionState(runId);

  if (!state) return NextResponse.json({ error: "Action not found" }, { status: 404 });

  return NextResponse.json({ state });
}
