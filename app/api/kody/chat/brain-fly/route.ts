/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-brain-fly-proxy
 *
 * POST /api/kody/chat/brain-fly
 *
 * Per-user Brain server proxy. Same wire shape as /api/kody/chat/brain
 * (request body + SSE response) but credentials are resolved server-side
 * by lazily provisioning a Fly Machine for the user — the dashboard never
 * stores or shows the brain URL/key.
 *
 * Lifecycle:
 *   1. requireKodyAuth + resolveFlyContext (reads FLY_API_TOKEN from the
 *      repo's secrets vault).
 *   2. provisionBrain() — idempotent. Creates the per-user app + machine
 *      on the first call (~30s); reuses both on later calls and returns
 *      the existing API key from the machine's env.
 *   3. streamBrainChat() — same proxy core used by /api/kody/chat/brain.
 *
 * When the user has no Fly token, the endpoint returns 400 with a
 * pointer back to the Secrets page. The chat-picker hides this agent
 * for that case, but the server still guards against direct calls.
 */

import { NextRequest, NextResponse } from "next/server";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { readBrainApp, writeBrainApp } from "@dashboard/lib/brain/store";
import { logger } from "@dashboard/lib/logger";
import {
  streamBrainChat,
  type BrainAttachment,
  type BrainDutyContext,
  type BrainTaskContext,
} from "@dashboard/lib/brain-proxy";
import {
  provisionBrain,
  waitForBrainHealth,
} from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import {
  withPageContext,
  withDashboardContext,
} from "@dashboard/lib/chat/page-context";
import { loadContextForPrompt } from "@dashboard/lib/context/files";

export const runtime = "nodejs";
// Hold the proxy open up to Vercel's ceiling; the proxy itself closes ~30s
// early with a `chat.reconnect` sentinel so the browser resumes cleanly.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Brain on Fly needs a Fly Machines token — add FLY_API_TOKEN to the repo Secrets vault.",
      },
      { status: 400 },
    );
  }

  let body: {
    chatId?: string;
    message?: string;
    taskContext?: BrainTaskContext;
    attachments?: BrainAttachment[];
    dutyContext?: BrainDutyContext;
    voiceMode?: boolean;
    resumeSince?: number;
    resumeText?: string;
    /** Noun phrase for the page the user is viewing (see page-context.ts). */
    currentPage?: string;
    /** First turn: fold the dashboard's curated Context into the message. */
    includeContext?: boolean;
    /** User-picked thinking level. Forwarded verbatim to Brain. */
    reasoningEffort?: string;
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

  // Provision (or reuse) the user's brain machine. Idempotent: returns
  // the existing apiKey when a live machine exists, otherwise creates one
  // and returns a fresh key. The Fly token is whatever `fly-context.ts`
  // resolved (env-first, vault fallback — single source of truth). The
  // app name is read from the storage record so the chat route stays in
  // sync with whatever the Runner card provisioned.
  const stored = await readBrainApp(
    ctx.context.account,
    ctx.context.githubToken,
  ).catch(() => null);
  const appNameOverride = stored?.appName;

  let provisioned: { url: string; apiKey: string; app?: string };
  try {
    const result = await provisionBrain({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      // Repo-less Brain: no boot repo. It clones each repo per chat message.
      // We still hand it the model resolved from the connected repo's config.
      model: ctx.context.engineModel,
      githubToken: ctx.context.githubToken,
      allSecrets: ctx.context.allSecrets,
      perfTier: ctx.context.perfTier,
      ...(appNameOverride ? { appNameOverride } : {}),
    });
    provisioned = { url: result.url, apiKey: result.apiKey, app: result.app };
    try {
      await writeBrainApp(ctx.context.account, ctx.context.githubToken, {
        version: 1,
        appName: result.app,
        orgSlug: result.org,
        createdAt: new Date().toISOString(),
      });
    } catch (writeErr) {
      logger.warn(
        { err: writeErr, owner: ctx.context.owner, app: result.app },
        "chat/brain-fly: record write failed (non-fatal)",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, owner: ctx.context.owner },
      "chat/brain-fly: provisionBrain failed",
    );
    return NextResponse.json(
      { error: `Brain provision failed: ${message}` },
      { status: 502 },
    );
  }

  // Provision returns when the Fly Machine API has accepted the create
  // call, but the Node server inside doesn't bind :8080 until the
  // entrypoint finishes the repo clone + model proxy + brain-serve startup.
  // Measured cold boot is ~105s and varies with git-clone time, so the
  // 120s default tipped over on normal variance. Budget 240s here (the
  // poll returns the instant /healthz is 200 — the larger number only
  // prevents premature failure, and stays well under maxDuration=300).
  // On reuse / resume-from-suspend the server is already up and this
  // returns on the first poll.
  try {
    await waitForBrainHealth(provisioned.url, 240_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, owner: ctx.context.owner, url: provisioned.url },
      "chat/brain-fly: brain server did not become healthy",
    );
    return NextResponse.json(
      { error: `Brain server did not become healthy: ${message}` },
      { status: 504 },
    );
  }

  const headerAuth = getRequestAuth(req);
  const repo = headerAuth
    ? `${headerAuth.owner}/${headerAuth.repo}`
    : undefined;
  const repoToken = headerAuth?.token;

  // First turn only: pull the dashboard's curated Context for the chat
  // audience. Cached 60s in-process; `null` when the repo has none.
  //
  // Best-effort: this is the ONLY first-turn-only step here, and it reaches
  // GitHub via server-side creds. If it throws (e.g. a misconfigured server
  // token/owner/repo in this environment), it must NOT take down the whole
  // chat — that would 500 the first message while every later message (which
  // omits includeContext) succeeds. Degrade to no-context instead.
  let dashboardContext: string | null = null;
  if (!isResume && body.includeContext) {
    try {
      dashboardContext = await loadContextForPrompt();
    } catch (err) {
      logger.warn(
        { err, owner: ctx.context.owner },
        "chat/brain-fly: dashboard Context load failed — proceeding without it",
      );
    }
  }

  return streamBrainChat({
    brainUrl: provisioned.url,
    brainKey: provisioned.apiKey,
    chatId,
    // Brain has no ambient-context slot; prefix page + standing dashboard
    // Context onto the user message (skip on resume — no new message).
    message: isResume
      ? ""
      : withDashboardContext(
          withPageContext(message ?? "", body.currentPage),
          dashboardContext,
        ),
    taskContext: body.taskContext,
    attachments: body.attachments,
    dutyContext: body.dutyContext,
    repo,
    repoToken,
    voiceMode: body.voiceMode === true,
    ...(body.reasoningEffort
      ? { reasoningEffort: body.reasoningEffort }
      : {}),
    // Per-user Brain on Fly answers in plain, simple terms (external /brain
    // keeps its own style). See PLAIN_LANGUAGE_PREAMBLE in brain-proxy.
    plainLanguage: true,
    ...(isResume
      ? { resumeSince: Number(body.resumeSince), resumeText: body.resumeText }
      : {}),
  });
}
