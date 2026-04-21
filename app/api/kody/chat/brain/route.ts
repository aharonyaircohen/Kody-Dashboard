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
import { requireKodyAuth } from '@dashboard/lib/auth'
import { logger } from '@dashboard/lib/logger'

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

  let body: { chatId?: string; message?: string }
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
      body: JSON.stringify({ message }),
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
    return NextResponse.json(
      { error: `Brain upstream returned ${upstream.status}` },
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
              // Surface tool use inline so the user sees what Brain did.
              // Brain doesn't stream tool output separately; the next `text`
              // event will contain the narrated result.
              assistantBuffer += `\n\n\u2699\ufe0f Tool: \`${ev.name ?? 'tool'}\`\n`
              emit({
                type: 'chat.message',
                role: 'assistant',
                content: assistantBuffer,
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
