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
import { streamText, stepCountIs, type ModelMessage } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { AGENT_KODY } from "@dashboard/lib/agents"
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth"
import { createUserOctokit, setGitHubContext, clearGitHubContext } from "@dashboard/lib/github-client"
import { logger } from "@dashboard/lib/logger"
import { getSecret } from "@dashboard/lib/vault/get-secret"
import { buildSystemPrompt, type MissionContext, type TaskContext } from "./system-prompt"
import { createGitHubTools } from "../tools/github-tools"
import { createPipelineTools } from "../tools/pipeline-tools"
import { createRemoteTools } from "../tools/remote-tools"
import { createBugTools } from "../tools/bug-tools"
import { createTaskTools } from "../tools/task-tools"
import { createReleaseTools } from "../tools/release-tools"
import { createKodyTools } from "../tools/kody-tools"
import { fetchUrlTool } from "../tools/fetch-url"

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
    /** When true, append a mission-drafting block to the system prompt. */
    missionDraft?: boolean
    /** Current mission context — scopes the chat to a specific mission issue. */
    mission?: MissionContext
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
    { missionDraft: body.missionDraft === true, mission: body.mission },
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
      ...createReleaseTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: body.actorLogin ?? null,
      }),
      ...createKodyTools({ octokit, owner: repo.owner, repo: repo.repo }),
    }
    // Pipeline tools currently use github-client's module-level context
    // (setGitHubContext below) — they do *not* take the per-request
    // octokit. Concurrent requests can race that state; we accept the
    // existing risk to reuse cached helpers.
    extraTools = {
      ...extraTools,
      ...createPipelineTools({ owner: repo.owner, repo: repo.repo }),
    }
    setGitHubContext(repo.owner, repo.repo, repo.token)
  }
  extraTools = {
    ...extraTools,
    ...createRemoteTools(body.actorLogin ?? null),
  }
  const tools = { ...baseTools, ...extraTools } as Parameters<typeof streamText>[0]["tools"]

  try {
    logger.info(
      {
        modelId,
        messageCount: messages.length,
        repo: repo ? `${repo.owner}/${repo.repo}` : null,
        task: body.task?.issueNumber ?? null,
        toolCount: Object.keys(tools ?? {}).length,
      },
      "kody-direct: streaming",
    )
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
      stopWhen: stepCountIs(10),
      // Ask Gemini 2.5+ to surface its thought summaries. The provider emits
      // them as reasoning parts; `sendReasoning: true` below forwards them on
      // the wire so the client can render a collapsed "Thinking" panel.
      providerOptions: {
        google: {
          thinkingConfig: { includeThoughts: true },
        },
      },
      onError: ({ error }) => {
        // streamText swallows per-chunk errors into the stream unless we
        // surface them here — without this a bad API key / quota /
        // 429 silently produces a zero-byte response.
        logger.error({ err: error, modelId }, "kody-direct: stream onError")
      },
      onFinish: () => {
        clearGitHubContext()
      },
    })
    return result.toUIMessageStreamResponse({
      sendReasoning: true,
    })
  } catch (err) {
    clearGitHubContext()
    logger.error({ err }, "kody-direct: stream failed")
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stream failed" },
      { status: 500 },
    )
  }
}
