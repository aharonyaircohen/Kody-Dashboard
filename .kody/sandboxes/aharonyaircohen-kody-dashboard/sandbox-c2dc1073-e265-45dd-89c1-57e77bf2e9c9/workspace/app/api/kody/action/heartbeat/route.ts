/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern action-heartbeat
 *
 * POST /api/kody/action/heartbeat
 * Action registers or updates its polling state.
 * Called by the GitHub Action at startup and periodically while polling.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  upsertActionState,
  getActionState,
} from "@dashboard/lib/kody-store/action-state";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";

export const runtime = "nodejs";

function authCheck(req: NextRequest): NextResponse | null {
  const secret = process.env.KODY_ACTION_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "KODY_ACTION_SECRET not configured" },
      { status: 500 },
    );
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer "))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.slice(7) !== secret)
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  return null;
}

export async function POST(req: NextRequest) {
  const authError = authCheck(req);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { runId, actionId, status, step, sessionId, taskId } = body as {
    runId: string;
    actionId?: string;
    status?: string;
    step?: string;
    sessionId?: string;
    taskId?: string;
  };

  if (!runId)
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  if (!actionId)
    return NextResponse.json({ error: "actionId required" }, { status: 400 });

  // Determine repo from request auth headers (set by client from localStorage).
  // Falls back to env vars (GITHUB_OWNER/GITHUB_REPO) if not present.
  const headerAuth = getRequestAuth(req);
  const owner =
    headerAuth?.owner ?? process.env.GITHUB_OWNER ?? "aharonyaircohen";
  const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? "Kody-Dashboard";

  const octokit = await getUserOctokit(req);
  const existing = await getActionState(runId, { owner, repo, octokit });

  const state = await upsertActionState(
    {
      runId,
      actionId,
      status:
        (status as "running" | "waiting" | "complete" | "cancelled") ??
        existing?.status ??
        "running",
      step: step ?? existing?.step ?? "",
      sessionId: sessionId ?? existing?.sessionId,
      taskId: taskId ?? existing?.taskId,
    },
    { owner, repo, octokit },
  );

  return NextResponse.json({ ok: true, state });
}
