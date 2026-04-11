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
import { enqueueInstruction, getActionState } from "@dashboard/lib/kody-store/action-state";
import { requireKodyAuth } from "@dashboard/lib/auth";

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

  const { runId, instruction } = body as { runId?: string; instruction?: string };

  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
  if (!instruction) return NextResponse.json({ error: "instruction required" }, { status: 400 });

  const state = await getActionState(runId);
  if (!state) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  const queued = await enqueueInstruction(runId, instruction);

  return NextResponse.json({
    ok: queued,
    queued: instruction,
    actionStatus: state.status,
  });
}
