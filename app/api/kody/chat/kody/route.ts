/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern direct-llm-stream
 *
 * POST /api/kody/chat/kody
 *
 * In-process chat endpoint for the "Kody" agent. Streams replies directly
 * from the configured provider (Gemini by default) using the Vercel AI SDK.
 * No GitHub Actions, no VPS, no runner cold start — the request goes
 * straight from the Vercel function to the model and back.
 *
 * Body: {
 *   messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
 *   model?: string   // optional provider-specific model id override
 * }
 *
 * Response: text/plain stream of the assistant reply (AI SDK text stream
 * protocol — client accumulates chunks into the assistant bubble).
 */

import { NextRequest, NextResponse } from "next/server"
import { streamText, type ModelMessage } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { AGENT_KODY } from "@dashboard/lib/agents"
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth"
import { logger } from "@dashboard/lib/logger"

export const runtime = "nodejs"
// Short chats only; 60 s is plenty for a single LLM call + streaming.
export const maxDuration = 60

// `gemini-2.0-flash` is retired for new API keys. Default to the current
// flash generation; override via KODY_DIRECT_MODEL env for other models.
const DEFAULT_MODEL = process.env.KODY_DIRECT_MODEL ?? "gemini-2.5-flash"

interface IncomingMessage {
  role: "user" | "assistant" | "system"
  content: string
}

/**
 * Compact task context the UI forwards when the user is chatting about
 * a specific task (same shape Brain receives). All fields optional.
 */
interface TaskContext {
  issueNumber?: number | string
  title?: string
  body?: string
  state?: string
  labels?: string[]
  column?: string
  pipeline?: { state?: string; currentStage?: string }
  associatedPR?: { number?: number; state?: string; html_url?: string }
}

function normalizeMessages(raw: IncomingMessage[]): ModelMessage[] {
  return raw
    .filter((m) => typeof m?.content === "string" && m.content.trim() !== "")
    .map((m) => ({ role: m.role, content: m.content }) as ModelMessage)
}

export function buildSystemPromptForTest(
  base: string,
  repo: { owner: string; repo: string } | null,
  task: TaskContext | undefined,
): string {
  return buildSystemPrompt(base, repo, task)
}

function buildSystemPrompt(
  base: string,
  repo: { owner: string; repo: string } | null,
  task: TaskContext | undefined,
): string {
  const sections: string[] = [base]
  if (repo) {
    sections.push(
      `## Connected repository\n\nYou are helping the user with the repository **${repo.owner}/${repo.repo}**. When the user refers to "the repo", "this repo", "the codebase", or a file path, they mean this repository. Ground your answers in the conversation context the user provides — do not invent file contents or PR numbers you haven't seen.`,
    )
  }
  if (task) {
    const lines: string[] = ["## Current task"]
    if (task.issueNumber != null) lines.push(`- Issue #${task.issueNumber}`)
    if (task.title) lines.push(`- Title: ${task.title}`)
    if (task.state) lines.push(`- State: ${task.state}`)
    if (task.column) lines.push(`- Column: ${task.column}`)
    if (task.labels?.length) lines.push(`- Labels: ${task.labels.join(", ")}`)
    if (task.pipeline?.state || task.pipeline?.currentStage) {
      lines.push(
        `- Pipeline: state=${task.pipeline.state ?? "?"}, stage=${task.pipeline.currentStage ?? "?"}`,
      )
    }
    if (task.associatedPR?.number) {
      lines.push(
        `- Associated PR: #${task.associatedPR.number} (${task.associatedPR.state ?? "?"}) ${task.associatedPR.html_url ?? ""}`.trim(),
      )
    }
    if (task.body) {
      const bodyPreview = task.body.length > 2000 ? `${task.body.slice(0, 2000)}…` : task.body
      lines.push(`\n### Task body\n\n${bodyPreview}`)
    }
    sections.push(lines.join("\n"))
  }
  return sections.join("\n\n")
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on the server" },
      { status: 503 },
    )
  }

  let body: {
    messages?: IncomingMessage[]
    model?: string
    task?: TaskContext
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const messages = normalizeMessages(body.messages ?? [])
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required (non-empty)" }, { status: 400 })
  }

  const modelId = body.model ?? DEFAULT_MODEL
  const google = createGoogleGenerativeAI({ apiKey })
  const repo = getRequestAuth(req)
  const systemPrompt = buildSystemPrompt(
    AGENT_KODY.systemPrompt,
    repo ? { owner: repo.owner, repo: repo.repo } : null,
    body.task,
  )

  try {
    logger.info(
      { modelId, messageCount: messages.length, repo: repo ? `${repo.owner}/${repo.repo}` : null, task: body.task?.issueNumber ?? null },
      "kody-direct: streaming",
    )
    const result = streamText({
      model: google(modelId),
      system: systemPrompt,
      messages,
      onError: ({ error }) => {
        // streamText swallows per-chunk errors into the stream unless we
        // surface them here — without this a bad API key / quota /
        // 429 silently produces a zero-byte response.
        logger.error({ err: error, modelId }, "kody-direct: stream onError")
      },
    })
    return result.toTextStreamResponse({
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  } catch (err) {
    logger.error({ err }, "kody-direct: stream failed")
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stream failed" },
      { status: 500 },
    )
  }
}
