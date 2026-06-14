/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern action-instruction
 *
 * POST /api/kody/action/instruction
 * Dashboard sends a user instruction to an action.
 * The instruction is queued (FIFO) and delivered on the action's next poll.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  enqueueInstruction,
  getActionState,
} from "@dashboard/lib/kody-store/action-state";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Require authenticated user — don't allow unauthenticated instruction injection
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { runId, instruction } = body as {
    runId?: string;
    instruction?: string;
  };

  if (!runId)
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  if (!instruction)
    return NextResponse.json(
      { error: "instruction required" },
      { status: 400 },
    );

  // Determine repo from request auth headers. Falls back to env vars.
  const headerAuth = getRequestAuth(req);
  const owner =
    headerAuth?.owner ?? process.env.GITHUB_OWNER ?? "aharonyaircohen";
  const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? "Kody-Dashboard";
  const octokit = await getUserOctokit(req);

  const state = await getActionState(runId, { owner, repo, octokit });
  if (!state) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  const queued = await enqueueInstruction(runId, instruction, {
    owner,
    repo,
    octokit,
  });

  return NextResponse.json({
    ok: queued,
    queued: instruction,
    actionStatus: state.status,
  });
}
