/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-trigger
 *
 * POST /api/kody/chat/trigger
 *
 * Appends the user's latest message to the in-memory session store and
 * ensures a runner is active. If the last dispatch was more than
 * RUNNER_FRESHNESS_MS ago (or no dispatch ever), fires a new
 * workflow_dispatch on kody2.yml; otherwise the existing runner picks
 * the message up on its next pull.
 *
 * This path no longer commits `.kody/sessions/<id>.jsonl` to git — chat
 * is ephemeral. Session state lives in memory; the runner pulls it via
 * /api/kody/chat/pull and streams events back via /api/kody/events/ingest.
 *
 * Body: {
 *   taskId: string       // sessionId (= taskId)
 *   messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>
 *   dashboardUrl?: string // base dashboard URL; the session token is appended
 * }
 */

import { NextRequest, NextResponse } from "next/server"
import { requireKodyAuth, getUserOctokit, getRequestAuth } from "@dashboard/lib/auth"
import { logger } from "@dashboard/lib/logger"
import { mintSessionToken } from "@dashboard/lib/chat-token"
import { appendUserTurn, markDispatched, needsDispatch, turnCount } from "@dashboard/lib/chat-session-store"

export const runtime = "nodejs"

/** Must match the runner's idle exit threshold (kody2 chat loop). */
const RUNNER_FRESHNESS_MS = 3 * 60 * 1000

function getEngineRepo(req: NextRequest): { owner: string; repo: string } {
  const override = (process.env.KODY_CHAT_WORKFLOW_REPO ?? "").trim()
  if (override && override.includes("/")) {
    const [owner, repo] = override.split("/").map((s) => s.trim())
    if (owner && repo) return { owner, repo }
  }
  const headerAuth = getRequestAuth(req)
  if (headerAuth) {
    return { owner: headerAuth.owner, repo: headerAuth.repo }
  }
  const { GITHUB_OWNER, GITHUB_REPO } = process.env as Record<string, string>
  return {
    owner: (GITHUB_OWNER ?? "aharonyaircohen").trim(),
    repo: (GITHUB_REPO ?? "Kody-Dashboard").trim(),
  }
}

const CHAT_WORKFLOW_ID = "kody2.yml"

function appendToken(baseUrl: string, token: string): string {
  // The runner uses this base URL for both /api/kody/chat/pull (long-poll for
  // new user turns) and /api/kody/events/ingest (push assistant events). The
  // HMAC token is shared across both endpoints so we ship it inline.
  const joiner = baseUrl.includes("?") ? "&" : "?"
  return `${baseUrl}${joiner}token=${token}`
}

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  timestamp: string
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  let body: {
    taskId?: string
    messages?: ChatMessage[]
    dashboardUrl?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { taskId, messages = [], dashboardUrl } = body

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 })
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 })
  }

  const latestUser = [...messages].reverse().find((m) => m.role === "user")
  if (!latestUser) {
    return NextResponse.json({ error: "no user message in payload" }, { status: 400 })
  }

  appendUserTurn(taskId, latestUser.content)

  const shouldDispatch = needsDispatch(taskId, RUNNER_FRESHNESS_MS)

  if (!shouldDispatch) {
    logger.info({ taskId, turns: turnCount(taskId) }, "chat: message queued, runner still warm")
    return NextResponse.json({ ok: true, taskId, dispatched: false })
  }

  const { owner, repo } = getEngineRepo(req)
  const workflowId = CHAT_WORKFLOW_ID

  const octokit = await getUserOctokit(req)
  if (!octokit) {
    return NextResponse.json({ error: "No GitHub token available" }, { status: 503 })
  }

  try {
    const token = mintSessionToken(taskId)
    const workflowInputs: Record<string, string> = {
      sessionId: taskId,
    }
    if (dashboardUrl) {
      workflowInputs.dashboardUrl = appendToken(dashboardUrl, token)
    }

    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref: "main",
      inputs: workflowInputs,
    })

    markDispatched(taskId)
    logger.info({ taskId, owner, repo, workflowId }, "chat: workflow dispatched")
    return NextResponse.json({ ok: true, taskId, dispatched: true, workflowId })
  } catch (err) {
    logger.error({ err, taskId }, "chat: dispatch failed")
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dispatch failed" },
      { status: 500 },
    )
  }
}
