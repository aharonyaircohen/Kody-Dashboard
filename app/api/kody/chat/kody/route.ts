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

import { randomBytes } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { streamText, stepCountIs, type ModelMessage } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { AGENT_KODY, getAgent, isValidAgentId, type AgentId } from "@dashboard/lib/agents"
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth"
import { createUserOctokit, setGitHubContext, clearGitHubContext } from "@dashboard/lib/github-client"
import { getSecret } from "@dashboard/lib/vault/get-secret"
import {
  buildSystemPrompt,
  type GoalContext,
  type JobContext,
  type TaskContext,
} from "./system-prompt"
import { createGitHubTools } from "../tools/github-tools"
import { createPipelineTools } from "../tools/pipeline-tools"
import { createRemoteTools } from "../tools/remote-tools"
import { createBugTools } from "../tools/bug-tools"
import { createTaskTools } from "../tools/task-tools"
import { createJobTools } from "../tools/job-tools"
import { createMemoryTools } from "../tools/memory-tools"
import { createPlannerTools } from "../tools/planner-tools"
import { createReleaseTools } from "../tools/release-tools"
import { createKodyTools } from "../tools/kody-tools"
import { fetchUrlTool } from "../tools/fetch-url"
import { featureTools } from "../tools/feature-tools"
import { loadMemoryIndexForPrompt } from "@dashboard/lib/memory-files"

export const runtime = "nodejs"
// Research turns can chain up to ~10 tool rounds (search → read → blame → …)
// each with its own LLM round-trip. 60s would cut us off mid-stream and the
// UI would hang. 300s is the Vercel Pro ceiling and gives plenty of slack.
export const maxDuration = 300

// `gemini-2.0-flash` is retired for new API keys. Default to the current
// flash generation; override via KODY_DIRECT_MODEL env for other models.
const DEFAULT_MODEL = process.env.KODY_DIRECT_MODEL ?? "gemini-2.5-flash"

interface IncomingTextPart {
  type: "text"
  text: string
}
interface IncomingImagePart {
  type: "image"
  /** base64 data URL (data:<mime>;base64,<...>) or raw http(s) URL */
  image: string
  mimeType?: string
}
interface IncomingFilePart {
  type: "file"
  data: string
  mediaType: string
  filename?: string
}
type IncomingPart = IncomingTextPart | IncomingImagePart | IncomingFilePart

interface IncomingMessage {
  role: "user" | "assistant" | "system"
  content: string | IncomingPart[]
}

function isPartsArray(c: unknown): c is IncomingPart[] {
  return Array.isArray(c) && c.every((p) => p && typeof p === "object" && "type" in p)
}

/**
 * The Vercel AI SDK accepts an `image` part as either a URL or raw
 * base64-encoded bytes. If we pass a `data:` URL string, it tries to
 * resolve it as a URL and rejects the `data:` scheme. Strip the
 * `data:<mime>;base64,` prefix and recover the mime type from it.
 */
function parseImageData(
  image: string,
  fallbackMime?: string,
): { data: string; mediaType?: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(image)
  if (m) return { data: m[2], mediaType: m[1] || fallbackMime }
  return { data: image, mediaType: fallbackMime }
}

function parseFileData(
  data: string,
  fallbackMime: string,
): { data: string; mediaType: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(data)
  if (m) return { data: m[2], mediaType: m[1] || fallbackMime }
  return { data, mediaType: fallbackMime }
}

// Cap on the number of prior turns we resend to Gemini. Long histories
// inflate the first round-trip dramatically (especially with thinking
// enabled and 20+ tool schemas), and older messages rarely change the
// next answer. The user-visible chat keeps its full transcript — only
// the request to the model is trimmed.
const MAX_HISTORY_MESSAGES = 16

// Cap on Gemini 2.5's thinking budget. Default is dynamic/uncapped which
// can stretch first-token latency well past the streaming-edge idle
// window. 2048 covers normal reasoning without runaway. Set to 0 to
// disable thinking entirely; -1 to restore the dynamic default.
const THINKING_BUDGET = 2048

// Stream tracing uses console.* (not the pino `logger`) on purpose: pino
// buffers writes asynchronously, and Vercel functions can be killed or
// suspended mid-stream — losing the trail. console.* is line-flushed on
// Vercel's runtime so we always see the events that fired before death.
function traceLog(data: object, msg: string): void {
  console.log(JSON.stringify({ level: "info", msg, ...data }))
}
function traceWarn(data: object, msg: string): void {
  console.warn(JSON.stringify({ level: "warn", msg, ...data }))
}
function traceError(data: object, msg: string): void {
  console.error(JSON.stringify({ level: "error", msg, ...data }))
}

function trimToRecent(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES)
  // Gemini rejects histories that don't start with a user message. Skip
  // any leading assistant/system messages in the trimmed slice.
  const firstUserIdx = trimmed.findIndex((m) => m.role === "user")
  return firstUserIdx <= 0 ? trimmed : trimmed.slice(firstUserIdx)
}

function normalizeMessages(raw: IncomingMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant" && m.role !== "system")) continue

    if (typeof m.content === "string") {
      if (m.content.trim() === "") continue
      out.push({ role: m.role, content: m.content } as ModelMessage)
      continue
    }

    if (!isPartsArray(m.content)) continue

    // Multimodal parts are only valid on a user message in the SDK shape.
    // Strip empty text parts; drop the message if nothing remains.
    const parts = m.content
      .map((p) => {
        if (p.type === "text") {
          return p.text.trim() === "" ? null : { type: "text" as const, text: p.text }
        }
        if (p.type === "image") {
          const parsed = parseImageData(p.image, p.mimeType)
          return {
            type: "image" as const,
            image: parsed.data,
            ...(parsed.mediaType ? { mediaType: parsed.mediaType } : {}),
          }
        }
        if (p.type === "file") {
          const parsed = parseFileData(p.data, p.mediaType)
          return {
            type: "file" as const,
            data: parsed.data,
            mediaType: parsed.mediaType,
            ...(p.filename ? { filename: p.filename } : {}),
          }
        }
        return null
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)

    if (parts.length === 0) continue
    if (m.role === "user") {
      out.push({ role: "user", content: parts })
    } else {
      // assistant/system can't carry image parts — collapse to text only.
      const text = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      if (text.trim() === "") continue
      out.push({ role: m.role, content: text } as ModelMessage)
    }
  }
  return out
}

export async function POST(req: NextRequest) {
  // Short trace ID lets us follow a single chat request through every log
  // line (start, per-tool start/finish, per-step finish, errors, finish).
  // Grep `vercel logs` for the ID to see one session's full trace.
  const traceId = randomBytes(4).toString("hex")
  const reqStartedAt = Date.now()

  const authError = await requireKodyAuth(req)
  if (authError) return authError

  // Vault first (per-repo .kody/secrets.enc), then env fallback. The
  // helper is a no-op when KODY_VAULT_KEY isn't set, so existing
  // env-only deployments keep working.
  const apiKey =
    (await getSecret("GEMINI_API_KEY", { req })) ??
    (await getSecret("GOOGLE_GENERATIVE_AI_API_KEY", { req }))
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
    /** GitHub login of the requester — gates remote_* tools. Optional. */
    actorLogin?: string
    /** When true, append a job-drafting block to the system prompt. */
    jobDraft?: boolean
    /** Current job context — scopes the chat to a specific job issue. */
    job?: JobContext
    /**
     * When true, append the goal-planning block to the system prompt and
     * wire the planner tools (`create_task_for_goal`). `goal` must be set.
     */
    goalPlanner?: boolean
    /** The goal this planner session is scoped to. */
    goal?: GoalContext
    /** Currently-viewed report on /reports — scopes the chat to advise on it. */
    report?: { slug: string; title: string; body: string }
    /**
     * Which agent persona to use for the system prompt. Defaults to `kody`.
     * Currently supported on this endpoint: `kody` (text) and `kody-speech`
     * (voice-tuned). All other agent ids fall back to `kody`.
     */
    agentId?: AgentId
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const allMessages = normalizeMessages(body.messages ?? [])
  if (allMessages.length === 0) {
    return NextResponse.json({ error: "messages required (non-empty)" }, { status: 400 })
  }
  const messages = trimToRecent(allMessages)
  const trimmedCount = allMessages.length - messages.length

  const modelId = body.model ?? DEFAULT_MODEL
  const google = createGoogleGenerativeAI({ apiKey })
  const repo = getRequestAuth(req)
  const goalPlannerActive = body.goalPlanner === true && !!body.goal

  // Memory index injection requires the github-client module-level context
  // (the cached loader uses `getOctokit()` / `getOwner()` / `getRepo()`).
  // Set the context here, before buildSystemPrompt, and rely on the
  // existing onFinish / catch paths to clear it. Per-request octokits
  // for GitHub tools are still created separately below to avoid races.
  let memoryIndex: string | null = null
  if (repo) {
    setGitHubContext(repo.owner, repo.repo, repo.token)
    try {
      memoryIndex = await loadMemoryIndexForPrompt()
    } catch (err) {
      // Memory is best-effort; never block the chat. Log and continue.
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: memory index load failed (continuing without it)",
      )
    }
  }

  // Pick the agent persona. Only `kody` and `kody-speech` route through
  // this endpoint today; anything else falls back to AGENT_KODY so older
  // clients keep working.
  const requestedAgentId =
    body.agentId && isValidAgentId(body.agentId) ? body.agentId : "kody"
  const agent =
    requestedAgentId === "kody-speech" ? getAgent("kody-speech") : AGENT_KODY

  const systemPrompt = buildSystemPrompt(
    agent.systemPrompt,
    repo ? { owner: repo.owner, repo: repo.repo } : null,
    body.task,
    {
      jobDraft: body.jobDraft === true,
      job: body.job,
      goalPlanner: goalPlannerActive,
      goal: goalPlannerActive ? body.goal : undefined,
      report: body.report,
      memoryIndex,
    },
  )

  // Build the per-request tool set. GitHub + pipeline tools require a
  // resolved repo; remote tools require a configured actorLogin. The
  // built-in `fetch_url` is always wired so the model can browse links.
  //
  // We intentionally do NOT use Gemini's provider tools (urlContext,
  // googleSearch) — Gemini forbids combining provider-defined tools
  // with custom function tools in one request, which would silently
  // disable everything else. `fetch_url` is the swap-in replacement.
  const baseTools: Record<string, unknown> = {
    fetch_url: fetchUrlTool,
    ...featureTools,
  }
  let extraTools: Record<string, unknown> = {}
  if (repo) {
    // Per-request Octokit (no shared singleton) so the GitHub tools
    // don't race other concurrent /api/kody/chat/kody requests.
    const octokit = createUserOctokit(repo.token)
    extraTools = {
      ...extraTools,
      ...createGitHubTools({ octokit, owner: repo.owner, repo: repo.repo }),
      ...createBugTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: body.actorLogin ?? null,
      }),
      ...createTaskTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: body.actorLogin ?? null,
      }),
      ...createJobTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: body.actorLogin ?? null,
      }),
      ...createMemoryTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: body.actorLogin ?? null,
      }),
      ...createReleaseTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: body.actorLogin ?? null,
      }),
      ...createKodyTools({ octokit, owner: repo.owner, repo: repo.repo }),
      ...(goalPlannerActive && body.goal
        ? createPlannerTools({
            octokit,
            owner: repo.owner,
            repo: repo.repo,
            actorLogin: body.actorLogin ?? null,
            goalId: body.goal.id,
          })
        : {}),
    }
    // Pipeline tools currently use github-client's module-level context
    // (already set above for the memory index loader) — they do *not* take
    // the per-request octokit. Concurrent requests can race that state;
    // we accept the existing risk to reuse cached helpers.
    extraTools = {
      ...extraTools,
      ...createPipelineTools({ owner: repo.owner, repo: repo.repo }),
    }
  }
  extraTools = {
    ...extraTools,
    ...createRemoteTools(body.actorLogin ?? null),
  }
  const tools = { ...baseTools, ...extraTools } as Parameters<typeof streamText>[0]["tools"]

  let stepNum = 0

  // Heartbeat warnings. If no step has finished by T+30s/T+60s, log a
  // warning so we can spot first-step stalls (Gemini taking forever before
  // any tokens / tool calls). Cleared at first step finish, completion, or
  // any error path. Declared outside the try so the catch can clear them.
  const heartbeats: NodeJS.Timeout[] = []
  const armHeartbeat = (ms: number) => {
    heartbeats.push(
      setTimeout(() => {
        if (stepNum === 0) {
          traceWarn(
            { traceId, elapsedMs: ms, messageCount: messages.length, modelId },
            "kody-direct: no step finished yet (model may be stuck before first token)",
          )
        }
      }, ms),
    )
  }
  const clearHeartbeats = () => {
    for (const h of heartbeats) clearTimeout(h)
    heartbeats.length = 0
  }

  try {
    traceLog(
      {
        traceId,
        modelId,
        messageCount: messages.length,
        trimmedFromHistory: trimmedCount,
        repo: repo ? `${repo.owner}/${repo.repo}` : null,
        task: body.task?.issueNumber ?? null,
        toolCount: Object.keys(tools ?? {}).length,
      },
      "kody-direct: streaming",
    )
    armHeartbeat(30_000)
    armHeartbeat(60_000)
    const result = streamText({
      model: google(modelId),
      system: systemPrompt,
      messages,
      tools,
      // Allow up to 10 tool-calling rounds so the model can run a real
      // research loop (search → read → blame → commits → re-search) in
      // one turn. Tools are individually rate-limit-aware (cache + ETag),
      // so 10 cache hits cost essentially nothing. Higher caps push us
      // toward the function timeout without meaningfully helping research.
      //
      // Goal planner is the exception: Pass 1 (broad research + listing)
      // and Pass 2 (per-task research + create) each chain ~2–4 calls per
      // task, so 10 silently truncates a 5-task plan after the first
      // create. Raise to 30 in planner mode so the full sweep can land.
      stopWhen: stepCountIs(goalPlannerActive ? 30 : 10),
      // Ask Gemini 2.5+ to surface its thought summaries (forwarded to the
      // client by `sendReasoning: true` below). The thinking budget is
      // capped — without it, dynamic thinking can stretch first-token
      // latency past the streaming-edge idle window for chat-style turns.
      //
      // Voice agent (`kody-speech`) disables thinking entirely: TTS would
      // read the thought summary aloud, and voice turns reward latency
      // over deliberation.
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: requestedAgentId !== "kody-speech",
            thinkingBudget:
              requestedAgentId === "kody-speech" ? 0 : THINKING_BUDGET,
          },
        },
      },
      // Per-tool tracing. `experimental_onToolCallStart` fires before the
      // tool's `execute` is invoked; `experimental_onToolCallFinish`
      // afterward with the SDK-measured `durationMs` and a success flag.
      // Together with onStepFinish they give us a per-step, per-tool view
      // of where time goes.
      experimental_onToolCallStart: ({ toolCall }) => {
        traceLog(
          {
            traceId,
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          },
          "kody-direct: tool start",
        )
      },
      experimental_onToolCallFinish: (event) => {
        const base = {
          traceId,
          tool: event.toolCall.toolName,
          toolCallId: event.toolCall.toolCallId,
          durationMs: event.durationMs,
        }
        if (event.success) {
          traceLog(base, "kody-direct: tool ok")
        } else {
          traceWarn(
            { ...base, err: event.error instanceof Error ? event.error.message : String(event.error) },
            "kody-direct: tool error",
          )
        }
      },
      onStepFinish: (step) => {
        stepNum++
        if (stepNum === 1) clearHeartbeats()
        traceLog(
          {
            traceId,
            step: stepNum,
            finishReason: step.finishReason,
            toolCalls: step.toolCalls?.map((c) => c.toolName) ?? [],
            usage: step.usage,
          },
          "kody-direct: step finish",
        )
      },
      onError: ({ error }) => {
        clearHeartbeats()
        // Server-side log of stream errors. We *also* surface the message
        // to the UI via the `onError` arg to toUIMessageStreamResponse
        // below, so the user sees what happened instead of a silent hang.
        traceError(
          { traceId, modelId, err: error instanceof Error ? error.message : String(error) },
          "kody-direct: stream onError",
        )
      },
      onFinish: (event) => {
        clearHeartbeats()
        clearGitHubContext()
        traceLog(
          {
            traceId,
            steps: stepNum,
            finishReason: event.finishReason,
            totalDuration: Date.now() - reqStartedAt,
            usage: event.usage,
          },
          "kody-direct: finish",
        )
      },
    })
    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      // Without this the SDK ships a generic "An error occurred." string.
      // Returning the real message turns silent hangs into visible failures
      // (rate limits, quota, bad tool args, etc.) — both for the user and
      // for support sessions where they paste the message back to us.
      onError: (error) => {
        clearHeartbeats()
        const msg = error instanceof Error ? error.message : String(error)
        traceError({ traceId, err: msg }, "kody-direct: ui-stream onError")
        return `[trace ${traceId}] ${msg}`
      },
    })
  } catch (err) {
    clearHeartbeats()
    clearGitHubContext()
    traceError(
      { traceId, err: err instanceof Error ? err.message : String(err) },
      "kody-direct: stream failed",
    )
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stream failed", traceId },
      { status: 500 },
    )
  }
}
