/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-brain-proxy
 *
 * POST /api/kody/chat/brain
 *
 * Forwards a chat turn to the Brain chat server (Claude Agent SDK with session
 * resume + live worktree). Streams Brain's SSE events back, translated into the
 * { type: 'chat.message' | 'chat.done' | 'chat.error' } shape that KodyChat.tsx
 * already understands.
 *
 * Unlike the default Kody path, Brain does NOT go through GitHub Actions /
 * Kody Engine. It's a synchronous streaming proxy.
 *
 * Body: { chatId: string; message: string }
 * Auth: requireKodyAuth (x-kody-token header or env token).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, requireKodyAuth } from '@dashboard/lib/auth'
import { logger } from '@dashboard/lib/logger'
import { fetchIssueAttachments } from '@dashboard/lib/issue-attachments'

export const runtime = 'nodejs'

interface BrainEvent {
  type: 'chat' | 'text' | 'tool_use' | 'done' | 'error'
  chatId?: string
  text?: string
  name?: string
  input?: unknown
  error?: string
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  // Prefer per-user Brain config supplied by the client (x-brain-url, x-brain-key)
  // over the server-wide env fallback. This keeps the dashboard repo/server-agnostic.
  const brainUrl =
    req.headers.get('x-brain-url')?.trim() || process.env.BRAIN_CHAT_URL
  const brainKey =
    req.headers.get('x-brain-key')?.trim() || process.env.BRAIN_CHAT_API_KEY

  if (!brainUrl || !brainKey) {
    return NextResponse.json(
      {
        error:
          'Brain is not configured for this session. Add a Brain server URL and API key on the login page.',
      },
      { status: 503 },
    )
  }

  interface TaskContextInput {
    issueNumber?: number
    title?: string
    body?: string
    state?: string
    labels?: string[]
    column?: string
    pipeline?: { state?: string; currentStage?: string | null }
    associatedPR?: { number?: number; state?: string; html_url?: string }
  }

  interface AttachmentInput {
    name?: string
    mimeType?: string
    /** Data URL like `data:image/png;base64,...` or raw base64. */
    data?: string
  }

  interface JobContextInput {
    number?: number
    title?: string
    body?: string
    state?: string
    labels?: string[]
  }

  let body: {
    chatId?: string
    message?: string
    taskContext?: TaskContextInput
    attachments?: AttachmentInput[]
    /** When true, prepend a job-drafting preamble to the user message. */
    jobDraft?: boolean
    /** Current job — scopes the chat to this job when set. */
    jobContext?: JobContextInput
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const chatId = body.chatId?.trim()
  const message = body.message
  if (!chatId) {
    return NextResponse.json({ error: 'chatId required' }, { status: 400 })
  }
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }

  // Build a compact task-context preamble. Brain's session memory carries this
  // forward on later turns, so we always include it when a task is selected —
  // cheap compared to context loss if the user references "this task".
  function formatTaskContext(tc: TaskContextInput | undefined): string | null {
    if (!tc || !tc.issueNumber) return null
    const parts: string[] = []
    parts.push(`[Current task context]`)
    parts.push(`- Issue: #${tc.issueNumber}${tc.title ? ` — ${tc.title}` : ''}`)
    if (tc.state) parts.push(`- State: ${tc.state}`)
    if (tc.column) parts.push(`- Column: ${tc.column}`)
    if (tc.labels?.length) parts.push(`- Labels: ${tc.labels.join(', ')}`)
    if (tc.pipeline?.state) {
      const stage = tc.pipeline.currentStage ? ` (stage: ${tc.pipeline.currentStage})` : ''
      parts.push(`- Pipeline: ${tc.pipeline.state}${stage}`)
    }
    if (tc.associatedPR?.number) {
      parts.push(
        `- PR: #${tc.associatedPR.number}${tc.associatedPR.state ? ` (${tc.associatedPR.state})` : ''}${
          tc.associatedPR.html_url ? ` — ${tc.associatedPR.html_url}` : ''
        }`,
      )
    }
    if (tc.body) {
      const truncated = tc.body.length > 1500 ? `${tc.body.slice(0, 1500)}…` : tc.body
      parts.push(`\n[Description]\n${truncated}`)
    }
    return parts.join('\n')
  }

  function formatJobContext(mc: JobContextInput | undefined): string | null {
    if (!mc || mc.number == null) return null
    const parts: string[] = []
    parts.push(`[Current job]`)
    parts.push(`- Job: #${mc.number}${mc.title ? ` — ${mc.title}` : ''}`)
    if (mc.state) parts.push(`- State: ${mc.state}`)
    if (mc.labels?.length) parts.push(`- Labels: ${mc.labels.join(', ')}`)
    if (mc.body) {
      const truncated = mc.body.length > 1500 ? `${mc.body.slice(0, 1500)}…` : mc.body
      parts.push(`\n[Job body]\n${truncated}`)
    }
    parts.push(
      '\nThe user is chatting about this specific job. A Kody job is a GitHub issue (label kody:job) whose body describes intent, system prompt, allowed commands, and restrictions. Answer grounded in the body above — do NOT claim the job does not exist.',
    )
    return parts.join('\n')
  }

  const taskPreamble = formatTaskContext(body.taskContext)
  const jobPreamble = formatJobContext(body.jobContext)
  const draftPreamble = body.jobDraft
    ? `[Job drafting mode]
The user is drafting a new Kody job — there is no existing job to look up. A Kody job is a GitHub issue (labelled kody:job) whose markdown body describes intent, system prompt, allowed commands, and restrictions. Ask concrete scoping questions one turn at a time, then produce a copy-ready markdown draft with those four sections so the user can click "Use as job" on your reply.`
    : null
  const preamble =
    [draftPreamble, jobPreamble, taskPreamble].filter(Boolean).join('\n\n') || null
  const decoratedMessage = preamble ? `${preamble}\n\n[User]\n${message}` : message

  // Forward attachments unchanged; Brain server converts them to multimodal
  // content blocks. Data URLs like `data:image/png;base64,...` are accepted.
  const clientAttachments = Array.isArray(body.attachments) ? body.attachments : []

  // When we're chatting in the context of a GitHub issue, also pull every
  // attachment referenced in the issue body and comments and hand them to
  // Brain alongside the user's chat attachments. We always re-send because
  // dashboard-side per-session caching isn't worth the complexity yet.
  let issueAttachments: Awaited<ReturnType<typeof fetchIssueAttachments>> = []
  if (body.taskContext?.issueNumber) {
    try {
      issueAttachments = await fetchIssueAttachments(body.taskContext.issueNumber)
    } catch (err) {
      logger.warn(
        { err, requestId: 'pre', issueNumber: body.taskContext.issueNumber },
        'Brain proxy: failed to resolve issue attachments (continuing without them)',
      )
    }
  }

  const attachments = [...clientAttachments, ...issueAttachments]

  // Brain now supports optional per-chat repo selection (owner/name). When the
  // dashboard knows which repo the user is connected to, forward it so Brain
  // can clone it into a worktree and enable code-context tools. The repo is
  // locked on the first turn, so sending it on every request is safe.
  const headerAuth = getRequestAuth(req)
  const repo = headerAuth ? `${headerAuth.owner}/${headerAuth.repo}` : undefined

  const requestId = crypto.randomUUID()
  const target = `${brainUrl.replace(/\/+$/, '')}/chats/${encodeURIComponent(chatId)}/messages`

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': brainKey,
      },
      body: JSON.stringify({
        message: decoratedMessage,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(repo ? { repo } : {}),
      }),
    })
  } catch (err) {
    logger.error({ err, requestId, chatId }, 'Brain proxy: fetch failed')
    return NextResponse.json(
      { error: 'Brain chat server unreachable' },
      { status: 502 },
    )
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '')
    logger.error({ requestId, chatId, status: upstream.status, text }, 'Brain upstream error')
    const detail = text.trim().slice(0, 500)
    return NextResponse.json(
      {
        error: detail
          ? `Brain upstream returned ${upstream.status}: ${detail}`
          : `Brain upstream returned ${upstream.status}`,
      },
      { status: 502 },
    )
  }

  logger.info({ requestId, chatId }, 'Brain proxy: streaming response')

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let assistantBuffer = ''

  const translated = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      const reader = upstream.body!.getReader()
      let buf = ''

      const parseBrainChunk = (text: string) => {
        const lines = text.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          let ev: BrainEvent
          try {
            ev = JSON.parse(raw) as BrainEvent
          } catch {
            continue
          }

          switch (ev.type) {
            case 'chat':
              // Handshake. Confirms the chatId. Nothing to render.
              break

            case 'text':
              if (typeof ev.text === 'string' && ev.text.length > 0) {
                assistantBuffer += ev.text
                emit({
                  type: 'chat.message',
                  role: 'assistant',
                  content: assistantBuffer,
                  timestamp: new Date().toISOString(),
                })
              }
              break

            case 'tool_use':
              // Emit a structured tool event so the client can attach it to
              // the in-flight assistant message and render a consolidated
              // "thinking" panel, rather than polluting the prose with inline
              // tool markers. Brain doesn't stream tool results separately —
              // the narrated output arrives in the next `text` chunk.
              emit({
                type: 'chat.tool_use',
                id: crypto.randomUUID(),
                name: ev.name ?? 'tool',
                input: ev.input ?? {},
                timestamp: new Date().toISOString(),
              })
              break

            case 'done':
              emit({ type: 'chat.done' })
              break

            case 'error':
              emit({ type: 'chat.error', error: ev.error ?? 'Brain error' })
              break
          }
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lastNewline = buf.lastIndexOf('\n')
          if (lastNewline !== -1) {
            parseBrainChunk(buf.slice(0, lastNewline + 1))
            buf = buf.slice(lastNewline + 1)
          }
        }
        if (buf.trim()) parseBrainChunk(buf)
      } catch (err) {
        logger.error({ err, requestId, chatId }, 'Brain stream read error')
        emit({ type: 'chat.error', error: 'Brain stream interrupted' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(translated, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
