/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-history
 *
 * GET /api/kody/chat/history?taskId=xxx
 *
 * Fetches the chat session history from the engine repo's session file.
 * Used when reopening a task's chat to restore full conversation context.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: unknown[];
}

// The engine repo is determined from auth headers (client's repo).
function getEngineRepo(req: NextRequest): { owner: string; repo: string } {
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    return { owner: headerAuth.owner, repo: headerAuth.repo };
  }
  const override = process.env.KODY_CHAT_WORKFLOW_REPO;
  if (override && override.includes("/")) {
    const [owner, repo] = override.split("/");
    return { owner, repo };
  }
  const { GITHUB_OWNER, GITHUB_REPO } = process.env as Record<string, string>;
  return {
    owner: GITHUB_OWNER ?? "aharonyaircohen",
    repo: GITHUB_REPO ?? "Kody-Dashboard",
  };
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const { owner, repo } = getEngineRepo(req);
  const sessionPath = `.kody/sessions/${taskId}.jsonl`;

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "No GitHub token available" },
      { status: 503 },
    );
  }

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: sessionPath,
      ref: "main",
    });

    if (!("content" in data) || !data.content) {
      return NextResponse.json({ messages: [] });
    }

    // GitHub returns content base64-encoded
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const messages: ChatMessage[] = [];
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line) as ChatMessage);
      } catch {
        // Skip malformed lines
      }
    }

    return NextResponse.json({ messages });
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 404) {
      return NextResponse.json({ messages: [] });
    }
    logger.error({ err, taskId }, "chat history: fetch failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch history" },
      { status: 500 },
    );
  }
}
