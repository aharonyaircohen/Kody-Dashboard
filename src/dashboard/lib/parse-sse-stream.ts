/**
 * SSE stream parsing utilities for Kody chat.
 *
 * Extracted from KodyChat component to enable unit testing.
 *
 * @fileType utility
 * @domain kody
 */

export interface ParseSSECallbacks {
  onTextDelta: (delta: string) => void
  onToolInputStart: (toolName: string) => void
  onToolOutputAvailable: () => void
  onError: (errorText: string) => void
}

/**
 * Parse a chunk of SSE-formatted text and invoke callbacks for recognized event types.
 *
 * Expects lines in the format: `data: <json>\n`
 * where json has a `type` field matching AI SDK v6 UI message stream protocol.
 */
export function parseSSEChunk(text: string, callbacks: ParseSSECallbacks): void {
  const lines = text.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6)
    if (data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data)
      switch (parsed.type) {
        case 'text-delta': {
          callbacks.onTextDelta(parsed.delta)
          break
        }
        case 'tool-input-start':
          callbacks.onToolInputStart(parsed.toolName)
          break
        case 'tool-output-available':
          callbacks.onToolOutputAvailable()
          break
        case 'error':
          callbacks.onError(parsed.errorText)
          break
      }
    } catch {
      /* skip malformed JSON */
    }
  }
}

/**
 * Process a ReadableStream of SSE data, buffering partial lines
 * and invoking parseSSEChunk on complete lines.
 *
 * Returns the accumulated text content from all text-delta events.
 */
export async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  callbacks: Omit<ParseSSECallbacks, 'onTextDelta'> & {
    onTextDelta?: (delta: string) => void
  },
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulatedContent = ''

  const fullCallbacks: ParseSSECallbacks = {
    onTextDelta: (delta) => {
      accumulatedContent += delta
      callbacks.onTextDelta?.(delta)
    },
    onToolInputStart: callbacks.onToolInputStart,
    onToolOutputAvailable: callbacks.onToolOutputAvailable,
    onError: callbacks.onError,
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lastNewline = buffer.lastIndexOf('\n')
    if (lastNewline !== -1) {
      parseSSEChunk(buffer.slice(0, lastNewline + 1), fullCallbacks)
      buffer = buffer.slice(lastNewline + 1)
    }
  }
  if (buffer.trim()) parseSSEChunk(buffer, fullCallbacks)

  return accumulatedContent
}
