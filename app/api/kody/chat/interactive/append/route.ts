/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern interactive-session-append
 *
 * POST /api/kody/chat/interactive/append
 *
 * Appends a user turn to a live interactive session. Does NOT dispatch a
 * new workflow — the long-lived runner picks up the new line on its next
 * git pull (default 30s).
 *
 * Body:
 *   { taskId: string;            // sessionId
 *     content: string;            // user message
 *     timestamp?: string;         // ISO; defaults to now
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { appendUserTurn } from "@dashboard/lib/interactive-session";
import {
  applyVibePrimerToContent,
  type VibeTaskContext,
} from "@dashboard/lib/vibe/primer";
import { withPageContext } from "@dashboard/lib/chat/core/page-context";

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
    content?: string;
    timestamp?: string;
    vibeMode?: boolean;
    taskContext?: VibeTaskContext;
    /** Noun phrase for the page the user is viewing (see page-context.ts). */
    currentPage?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, content, timestamp, vibeMode, taskContext, currentPage } =
    body;
  if (!taskId)
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }

  const { owner, repo } = getEngineRepo(req);
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "No GitHub token available" },
      { status: 503 },
    );
  }

  // Vibe primer is server-only — the dashboard never shows it. The
  // long-lived runner reads each user turn from the session JSONL on
  // its next pull, so the primer must travel with the turn content.
  // Page context rides along the same way: the runner has no system slot
  // for "what page is the user on", so it goes in the turn.
  const effectiveContent = withPageContext(
    vibeMode ? applyVibePrimerToContent(content, taskContext) : content,
    currentPage,
  );

  try {
    const turnTimestamp = timestamp ?? new Date().toISOString();
    const result = await appendUserTurn(octokit, owner, repo, taskId, {
      role: "user",
      content: effectiveContent,
      timestamp: turnTimestamp,
    });

    logger.info(
      { taskId, turnCount: result.turnCount },
      "interactive: appended user turn",
    );
    return NextResponse.json({ ok: true, taskId, turnCount: result.turnCount });
  } catch (err) {
    logger.error({ err, taskId }, "interactive: append failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Append failed" },
      { status: 500 },
    );
  }
}
