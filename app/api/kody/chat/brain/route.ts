/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-brain-proxy
 *
 * POST /api/kody/chat/brain
 *
 * Forwards a chat turn to the user's externally-hosted Brain server (URL +
 * API key set in Settings, sent here as `x-brain-url` / `x-brain-key`).
 *
 * For the per-user Brain server auto-provisioned on Fly, see
 * /api/kody/chat/brain-fly — same proxy core (`streamBrainChat`), different
 * credential source.
 *
 * Body: { chatId, message, taskContext?, attachments?, dutyContext?, dutyDraft? }
 * Auth: requireKodyAuth.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import {
  streamBrainChat,
  type BrainAttachment,
  type BrainDutyContext,
  type BrainTaskContext,
} from "@dashboard/lib/brain-proxy";

export const runtime = "nodejs";
// Hold the proxy open up to Vercel's ceiling; the proxy itself closes ~30s
// early with a `chat.reconnect` sentinel so the browser resumes cleanly.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  // Per-user Brain config from headers (preferred) → server-wide env fallback.
  const brainUrl =
    req.headers.get("x-brain-url")?.trim() || process.env.BRAIN_CHAT_URL;
  const brainKey =
    req.headers.get("x-brain-key")?.trim() || process.env.BRAIN_CHAT_API_KEY;

  if (!brainUrl || !brainKey) {
    return NextResponse.json(
      {
        error:
          "Brain is not configured for this session. Add a Brain server URL and API key on the login page.",
      },
      { status: 503 },
    );
  }

  let body: {
    chatId?: string;
    message?: string;
    taskContext?: BrainTaskContext;
    attachments?: BrainAttachment[];
    dutyDraft?: boolean;
    dutyContext?: BrainDutyContext;
    voiceMode?: boolean;
    resumeSince?: number;
    resumeText?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const chatId = body.chatId?.trim();
  const message = body.message;
  // A reconnect carries `resumeSince` and no message — it re-attaches to an
  // in-flight turn rather than starting a new one.
  const isResume = Number.isFinite(body.resumeSince);
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }
  if (!isResume && (!message || typeof message !== "string")) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  // Forward the user's connected repo so Brain can clone it into a worktree
  // and enable code-context tools. Locked on first turn by Brain.
  const headerAuth = getRequestAuth(req);
  const repo = headerAuth
    ? `${headerAuth.owner}/${headerAuth.repo}`
    : undefined;
  // Forward the user's token too — a dev Brain server has no GitHub creds of
  // its own, so without this the worktree clone of a private repo fails.
  const repoToken = headerAuth?.token;

  return streamBrainChat({
    brainUrl,
    brainKey,
    chatId,
    message: message ?? "",
    taskContext: body.taskContext,
    attachments: body.attachments,
    dutyDraft: body.dutyDraft,
    dutyContext: body.dutyContext,
    repo,
    repoToken,
    voiceMode: body.voiceMode === true,
    ...(isResume
      ? { resumeSince: Number(body.resumeSince), resumeText: body.resumeText }
      : {}),
  });
}
