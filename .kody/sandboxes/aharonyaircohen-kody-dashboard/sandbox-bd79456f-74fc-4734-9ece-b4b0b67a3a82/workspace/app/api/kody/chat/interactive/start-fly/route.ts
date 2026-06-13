/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern interactive-session-start-fly
 *
 * POST /api/kody/chat/interactive/start-fly
 *
 * Same shape as /interactive/start, but instead of dispatching the
 * `kody.yml` workflow on GitHub Actions, spawns a Fly Machine that runs
 * the same engine image. Used by the `kody-live-fly` agent.
 *
 * The session JSONL lives in the same place (.kody/sessions/{id}.jsonl)
 * so the existing append + event-stream paths work unchanged — only the
 * runtime moves.
 *
 * Body: see /interactive/start (taskId, idleExitMs, hardCapMs).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import {
  buildMetaLine,
  writeSessionMeta,
} from "@dashboard/lib/interactive-session";
import {
  applyVibePrimerToContent,
  type VibeTaskContext,
} from "@dashboard/lib/vibe/primer";
import { mintSessionToken } from "@dashboard/lib/chat-token";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import { claimOrSpawnFly } from "@dashboard/lib/runners/fly-run";

export const runtime = "nodejs";

/**
 * Chat is unique among Fly-spawning routes: it may target a separate
 * "engine repo" (where `kody.yml` lives) instead of the user's connected
 * repo. KODY_CHAT_WORKFLOW_REPO opts in; otherwise the connected repo
 * from header auth is used (same as the shared context default).
 */
function getChatRepoOverride(): { owner: string; repo: string } | undefined {
  const override = (process.env.KODY_CHAT_WORKFLOW_REPO ?? "").trim();
  if (!override || !override.includes("/")) return undefined;
  const [owner, repo] = override.split("/").map((s) => s.trim());
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: {
    taskId?: string;
    idleExitMs?: number;
    hardCapMs?: number;
    /**
     * Base URL the runner POSTs chat events to. The route appends an inline
     * HMAC token so the ingest endpoint can authenticate the Fly machine
     * (its IP isn't in GitHub's CIDR list). Optional — when absent the
     * runner falls back to git-polling the session JSONL.
     */
    dashboardUrl?: string;
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

  const {
    taskId,
    idleExitMs,
    hardCapMs,
    dashboardUrl,
    content,
    vibeMode,
    taskContext,
  } = body;
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const ctxResult = await resolveFlyContext(req, {
    repoOverride: getChatRepoOverride(),
  });
  if (!ctxResult.ok) {
    return NextResponse.json(
      { error: ctxResult.error },
      { status: ctxResult.status },
    );
  }
  const { owner, repo, octokit } = ctxResult.context;

  try {
    logger.info(
      { taskId, owner, repo, idleExitMs, hardCapMs },
      "interactive-fly: starting session",
    );

    // Same meta-line write as the Actions path — the engine relies on it
    // to recognize interactive mode regardless of which runtime it boots in.
    // Fold the first user turn into this same commit (see /interactive/start)
    // so the kickoff can't be lost to a start-vs-append write race.
    const meta = buildMetaLine({ idleExitMs, hardCapMs });
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

    // dashboardUrl + inline HMAC token so the runner can push events
    // straight to /api/kody/events/ingest. The Fly machine's source IP
    // isn't in GitHub Actions's CIDR list, so the token is the only way
    // it gets past the ingest auth gate.
    let ingestUrl: string | undefined;
    if (dashboardUrl) {
      const token = mintSessionToken(taskId);
      const joiner = dashboardUrl.includes("?") ? "&" : "?";
      ingestUrl = `${dashboardUrl}${joiner}sessionId=${encodeURIComponent(
        taskId,
      )}&token=${token}`;
    }

    // Shared with the GitHub→Fly fallback in /interactive/start so the two
    // paths can't drift.
    const result = await claimOrSpawnFly(ctxResult.context, {
      taskId,
      idleExitMs,
      hardCapMs,
      dashboardUrl: ingestUrl,
    });

    logger.info(
      {
        taskId,
        machineId: result.machineId,
        runner: result.runner,
        owner,
        repo,
      },
      "interactive-fly: session started on Fly",
    );

    return NextResponse.json({
      ok: true,
      taskId,
      mode: "interactive",
      runner: result.runner,
      machineId: result.machineId,
      target: { owner, repo, branch: "main", workflow: "fly" },
    });
  } catch (err) {
    logger.error({ err, taskId }, "interactive-fly: start failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Start failed" },
      { status: 500 },
    );
  }
}
