/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern interactive-session-start
 *
 * POST /api/kody/chat/interactive/start
 *
 * Starts a long-lived "interactive runner" chat session. Writes the meta
 * line to `.kody/sessions/{sessionId}.jsonl` (no user turn yet) and
 * dispatches `kody.yml`. The runner detects the meta line, enters its
 * poll loop, and emits `chat.ready` to signal the dashboard to unlock
 * input. New user messages get appended via /api/kody/chat/interactive/append
 * — they do NOT trigger a fresh workflow dispatch.
 *
 * Body:
 *   { taskId: string;                // sessionId
 *     dashboardUrl?: string;          // base URL; HMAC token appended server-side
 *     idleExitMs?: number;            // optional override (engine default 5min)
 *     hardCapMs?: number;             // optional override (engine default 30min, max 360min)
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import {
  buildMetaLine,
  writeSessionMeta,
} from "@dashboard/lib/interactive-session";
import {
  applyVibePrimerToContent,
  type VibeTaskContext,
} from "@dashboard/lib/vibe/primer";

export const runtime = "nodejs";

function getEngineRepo(req: NextRequest): { owner: string; repo: string } {
  const override = (process.env.KODY_CHAT_WORKFLOW_REPO ?? "").trim();
  if (override && override.includes("/")) {
    const [owner, repo] = override.split("/").map((s) => s.trim());
    if (owner && repo) return { owner, repo };
  }
  const headerAuth = getRequestAuth(req);
  if (headerAuth) return { owner: headerAuth.owner, repo: headerAuth.repo };
  const { GITHUB_OWNER, GITHUB_REPO } = process.env as Record<string, string>;
  return {
    owner: (GITHUB_OWNER ?? "aharonyaircohen").trim(),
    repo: (GITHUB_REPO ?? "Kody-Dashboard").trim(),
  };
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: {
    taskId?: string;
    idleExitMs?: number;
    hardCapMs?: number;
    content?: string;
    timestamp?: string;
    vibeMode?: boolean;
    taskContext?: VibeTaskContext;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, idleExitMs, hardCapMs, content, vibeMode, taskContext } =
    body;
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const { owner, repo } = getEngineRepo(req);
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "No GitHub token available" },
      { status: 503 },
    );
  }

  try {
    logger.info(
      { taskId, owner, repo, idleExitMs, hardCapMs },
      "interactive: starting session",
    );

    const meta = buildMetaLine({ idleExitMs, hardCapMs });
    // If the caller supplied the first user turn (the vibe auto-kickoff, or a
    // first message typed before the runner is up), write it INTO the same
    // commit as the meta line. Doing it here — instead of a follow-up
    // /interactive/append — removes the start-vs-append write race that was
    // dropping the kickoff turn and leaving the runner with nothing to do.
    const initialTurn =
      content && content.trim().length > 0
        ? {
            role: "user" as const,
            content: vibeMode
              ? applyVibePrimerToContent(content, taskContext)
              : content,
            timestamp: body.timestamp ?? new Date().toISOString(),
          }
        : undefined;
    await writeSessionMeta(
      octokit,
      owner,
      repo,
      taskId,
      meta,
      undefined,
      undefined,
      initialTurn,
    );

    // No dashboardUrl: the engine HttpSink would push events to /ingest in
    // real time, but Vercel's per-instance in-memory bus means the push
    // often misses the client's poll handler. Falling back to plain client
    // polling (every 3s with ETag caching) is simpler and reliable.
    const workflowInputs: Record<string, string> = { sessionId: taskId };

    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: "kody.yml",
      ref: "main",
      inputs: workflowInputs,
    });

    logger.info(
      { taskId, workflowId: "kody.yml", owner, repo },
      "interactive: workflow dispatched",
    );
    return NextResponse.json({
      ok: true,
      taskId,
      mode: "interactive",
      target: { owner, repo, branch: "main", workflow: "kody.yml" },
    });
  } catch (err) {
    logger.error({ err, taskId }, "interactive: start failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Start failed" },
      { status: 500 },
    );
  }
}
