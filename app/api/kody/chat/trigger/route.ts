/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-trigger
 *
 * POST /api/kody/chat/trigger
 *
 * Persists the chat session file to the target repo, then dispatches the
 * engine's `kody.yml` workflow with chat-mode inputs. The engine reads
 * `.kody/sessions/{sessionId}.jsonl`, runs `kody dispatch` → chat flow,
 * and streams events back to the dashboard via the ingest endpoint using
 * the inline HMAC token embedded in `dashboardUrl`.
 *
 * Body: {
 *   taskId: string       // sessionId (= taskId)
 *   messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>
 *   dashboardUrl?: string // base dashboard URL; the ingest token is appended server-side
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { mintSessionToken } from "@dashboard/lib/chat-token";
import {
  applyVibePrimerToMessages,
  type VibeTaskContext,
} from "@dashboard/lib/vibe/primer";
import { Buffer } from "buffer";

export const runtime = "nodejs";

// The chat workflow dispatches against the connected repo by default — that's
// where the user wants chat to operate (reads their code, runs tools on it).
// `KODY_CHAT_WORKFLOW_REPO` is an explicit override for deployments that
// centralize the engine workflow in one repo.
function getEngineRepo(req: NextRequest): { owner: string; repo: string } {
  const override = (process.env.KODY_CHAT_WORKFLOW_REPO ?? "").trim();
  if (override && override.includes("/")) {
    const [owner, repo] = override.split("/").map((s) => s.trim());
    if (owner && repo) return { owner, repo };
  }
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    return { owner: headerAuth.owner, repo: headerAuth.repo };
  }
  const { GITHUB_OWNER, GITHUB_REPO } = process.env as Record<string, string>;
  return {
    owner: (GITHUB_OWNER ?? "aharonyaircohen").trim(),
    repo: (GITHUB_REPO ?? "Kody-Dashboard").trim(),
  };
}

// Chat workflow file is always `kody.yml`. The KODY_CHAT_WORKFLOW_ID env
// var is intentionally ignored — it was a debugging knob that accumulated
// stale values across Vercel projects and caused hard-to-diagnose 404s.
function getChatWorkflowId(): string {
  return "kody.yml";
}

function appendIngestToken(baseUrl: string, sessionId: string): string {
  const token = mintSessionToken(sessionId);
  const joiner = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${joiner}token=${token}`;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: unknown[];
}

// Primer logic now lives in @dashboard/lib/vibe/primer so the long-lived
// runner path (/interactive/append) and this one-shot dispatch path share
// the same wording.

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: {
    taskId?: string;
    messages?: ChatMessage[];
    dashboardUrl?: string;
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
    messages: rawMessages = [],
    dashboardUrl,
    vibeMode,
    taskContext,
  } = body;
  const messages = vibeMode
    ? applyVibePrimerToMessages(rawMessages, taskContext)
    : rawMessages;

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const { owner, repo } = getEngineRepo(req);
  const workflowId = getChatWorkflowId();
  const sessionPath = `.kody/sessions/${taskId}.jsonl`;

  // Serialize messages as JSONL
  const jsonlContent =
    messages
      .map((m) =>
        JSON.stringify({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          toolCalls: m.toolCalls ?? [],
        }),
      )
      .join("\n") + "\n";

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "No GitHub token available" },
      { status: 503 },
    );
  }

  const encodedContent = Buffer.from(jsonlContent).toString("base64");

  try {
    logger.info(
      { taskId, owner, repo, messageCount: messages.length },
      "chat: writing session file",
    );

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
      const e = err as { status?: number };
      if (e.status !== 404) {
        logger.warn(
          { err, taskId },
          "chat: could not check existing session file",
        );
      }
    }

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

    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

    const workflowInputs: Record<string, string> = {
      sessionId: taskId,
      message: lastUserMessage,
    };
    if (dashboardUrl) {
      workflowInputs.dashboardUrl = appendIngestToken(dashboardUrl, taskId);
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
