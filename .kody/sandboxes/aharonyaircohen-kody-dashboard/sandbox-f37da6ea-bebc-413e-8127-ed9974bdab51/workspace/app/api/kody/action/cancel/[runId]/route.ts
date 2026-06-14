/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern action-cancel
 *
 * POST /api/kody/action/cancel/:runId
 * Dashboard cancels an action — sets cancel=true in state.
 * The action's poll loop sees this and exits gracefully.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  cancelAction,
  getActionState,
} from "@dashboard/lib/kody-store/action-state";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const { runId } = await params;

  const headerAuth = getRequestAuth(req);
  const owner =
    headerAuth?.owner ?? process.env.GITHUB_OWNER ?? "aharonyaircohen";
  const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? "Kody-Dashboard";
  const octokit = await getUserOctokit(req);

  const state = await getActionState(runId, { owner, repo, octokit });
  if (!state)
    return NextResponse.json({ error: "Action not found" }, { status: 404 });

  const identity = req.headers.get("x-user-login") ?? "unknown";
  const updated = await cancelAction(runId, identity, { owner, repo, octokit });

  return NextResponse.json({ ok: true, state: updated });
}
