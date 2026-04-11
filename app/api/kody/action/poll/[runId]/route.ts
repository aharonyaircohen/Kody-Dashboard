/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern action-poll
 *
 * GET /api/kody/action/poll/:runId
 * Action polls for the next instruction or cancel signal.
 * Returns the next queued instruction (FIFO) and checks cancel flag.
 */

import { NextRequest, NextResponse } from "next/server";
import { pollInstruction } from "@dashboard/lib/kody-store/action-state";

export const runtime = "nodejs";

function authCheck(req: NextRequest): NextResponse | null {
  const secret = process.env.KODY_ACTION_SECRET;
  if (!secret) return NextResponse.json({ error: "KODY_ACTION_SECRET not configured" }, { status: 500 });
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.slice(7) !== secret) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const authError = authCheck(_req);
  if (authError) return authError;

  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  const result = await pollInstruction(runId, runId);

  // If a different actionId owns this run, the caller should exit
  if (result.actionId && result.actionId !== runId) {
    return NextResponse.json({ takeover: true });
  }

  return NextResponse.json({
    instruction: result.instruction,
    cancel: result.cancel,
    cancelledBy: result.cancelledBy,
  });
}
