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
import { requireKodyAuth, getUserOctokit, getRequestAuth } from "@dashboard/lib/auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  let authError: NextResponse | null = null;
  try {
    authError = await requireKodyAuth(req);
  } catch (err) {
    // verifyKodySession can throw if the JWT is malformed — treat as 401
    return NextResponse.json(
      { error: "Authentication failed", message: (err as Error)?.message },
      { status: 401 },
    );
  }
  if (authError) return authError;

  const { runId } = await params;

  const headerAuth = getRequestAuth(req);
  const owner = headerAuth?.owner ?? process.env.GITHUB_OWNER ?? "aharonyaircohen";
  const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? "Kody-Dashboard";

  let octokit;
  try {
    octokit = await getUserOctokit(req);
  } catch (err) {
    // Malformed token in session cookie — treat as auth failure
    return NextResponse.json(
      { error: "Authentication failed", message: (err as Error)?.message },
      { status: 401 },
    );
  }

  if (!octokit) {
    return NextResponse.json(
      { error: "No GitHub token available" },
      { status: 401 },
    );
  }

  let state;
  try {
    state = await getActionState(runId, { owner, repo, octokit });
  } catch (err) {
    console.error("[Kody] Error fetching action state:", err);
    return NextResponse.json(
      { error: "Failed to fetch action state", message: (err as Error)?.message },
      { status: 500 },
    );
  }

  if (!state) return NextResponse.json({ error: "Action not found" }, { status: 404 });

  return NextResponse.json({ state });
}
