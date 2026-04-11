/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-trigger
 *
 * POST /api/kody/chat/trigger
 *
 * Persists a chat message to the engine repo session file, then
 * triggers the engine's `chat.yml` workflow via GitHub Actions API.
 *
 * Body: {
 *   taskId: string       // sessionId (= taskId)
 *   messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>
 *   dashboardUrl?: string // passed to workflow so it knows where to POST events
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getUserOctokit } from "@dashboard/lib/auth";
import { GITHUB_OWNER, GITHUB_REPO } from "@dashboard/lib/constants";
import { logger } from "@dashboard/lib/logger";
import { Buffer } from "buffer";

export const runtime = "nodejs";

// The engine repo where the chat workflow and session files live.
// Override with KODY_CHAT_WORKFLOW_REPO env var (format: "owner/repo").
function getEngineRepo(): { owner: string; repo: string } {
  const override = process.env.KODY_CHAT_WORKFLOW_REPO;
  if (override && override.includes("/")) {
    const [owner, repo] = override.split("/");
    return { owner, repo };
  }
  return { owner: GITHUB_OWNER, repo: GITHUB_REPO };
}

function getChatWorkflowId(): string {
  return process.env.KODY_CHAT_WORKFLOW_ID ?? "chat.yml";
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: unknown[];
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: {
    taskId?: string;
    messages?: ChatMessage[];
    dashboardUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, messages = [], dashboardUrl } = body;

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const { owner, repo } = getEngineRepo();
  const workflowId = getChatWorkflowId();
  const sessionPath = `.kody/sessions/${taskId}.jsonl`;

  // Serialize messages as JSONL
  const jsonlContent = messages
    .map((m) => JSON.stringify({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.toolCalls ?? [],
    }))
    .join("\n") + "\n";

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "No GitHub token available" }, { status: 503 });
  }

  const encodedContent = Buffer.from(jsonlContent).toString("base64");

  try {
    logger.info({ taskId, owner, repo, messageCount: messages.length }, "chat: writing session file");

    // Try to get the existing file SHA (for update), or create new
    let sha: string | undefined;
    try {
      const existing = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: sessionPath,
        ref: "main",
      });
      if ("sha" in existing.data && typeof existing.data.sha === "string") {
        sha = existing.data.sha;
      }
    } catch (err: unknown) {
      // File doesn't exist yet — that's fine, we'll create it
      const e = err as { status?: number };
      if (e.status !== 404) {
        logger.warn({ err, taskId }, "chat: could not check existing session file");
      }
    }

    // Write (or overwrite) the session file
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: sessionPath,
      message: `chat: update session ${taskId}`,
      content: encodedContent,
      ...(sha ? { sha } : {}),
      branch: "main",
    });

    logger.info({ taskId, owner, repo }, "chat: triggering workflow");

    // Trigger the chat.yml workflow
    const workflowInputs: Record<string, { value: string }> = {
      sessionId: { value: taskId },
    };
    if (dashboardUrl) {
      workflowInputs.dashboardUrl = { value: dashboardUrl };
    }

    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref: "main",
      inputs: workflowInputs,
    });

    logger.info({ taskId, workflowId }, "chat: workflow dispatched");

    return NextResponse.json({ ok: true, taskId, workflowId });
  } catch (err) {
    logger.error({ err, taskId }, "chat: trigger failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Trigger failed" },
      { status: 500 },
    );
  }
}
