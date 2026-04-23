/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Lightweight HTTP fetcher tool — replaces Gemini URL Context
 *  in routes that also wire custom function tools (Gemini forbids mixing
 *  provider-defined and custom tools in one request). No Playwright; HTML
 *  is stripped to plain text. SPA pages will return mostly empty bodies —
 *  that's a known limitation, surfaced via the `truncated` / empty content
 *  rather than failure.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { logger } from '@dashboard/lib/logger'

const MAX_BYTES = 1_000_000 // 1 MB cap on raw response
const MAX_TEXT = 30_000 // 30 KB cap returned to the model
const FETCH_TIMEOUT_MS = 15_000

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^169\.254\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^fc00:/i,
  /^fe80:/i,
]

function isPrivateHost(host: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host))
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html)
  return m ? m[1].trim() : null
}

export const fetchUrlTool = tool({
  description:
    'Fetch a public http(s) URL and return its plain-text content. Use this ' +
    'when the user shares a link and wants you to read it. HTML is stripped ' +
    'to text — JavaScript-rendered SPAs will return mostly empty content; ' +
    'say so when that happens rather than guessing.',
  inputSchema: z.object({
    url: z.string().url().describe('Absolute http(s) URL to fetch'),
  }),
  execute: async ({ url }) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { error: 'Invalid URL' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'Only http(s) URLs are allowed' }
    }
    if (isPrivateHost(parsed.hostname.toLowerCase())) {
      return { error: 'Private/internal URLs are blocked' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Kody-Dashboard/1.0',
          Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
        },
      })
      const ct = res.headers.get('content-type') ?? ''
      const reader = res.body?.getReader()
      if (!reader) return { error: 'No response body' }

      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          total += value.byteLength
          if (total > MAX_BYTES) {
            await reader.cancel().catch(() => {})
            break
          }
          chunks.push(value)
        }
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)))
      const raw = buf.toString('utf8')

      let content: string
      let title: string | null = null
      if (ct.includes('json')) {
        // Pretty-print to keep the model happy
        try {
          content = JSON.stringify(JSON.parse(raw), null, 2)
        } catch {
          content = raw
        }
      } else if (ct.includes('html') || /<html[\s>]/i.test(raw.slice(0, 1000))) {
        title = extractTitle(raw)
        content = stripHtml(raw)
      } else {
        content = raw
      }

      const truncated = content.length > MAX_TEXT
      if (truncated) content = `${content.slice(0, MAX_TEXT)}\n\n[... truncated ${content.length - MAX_TEXT} chars ...]`

      return {
        url: res.url,
        status: res.status,
        contentType: ct || null,
        title,
        content,
        truncated,
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { error: 'Request timed out after 15s' }
      }
      logger.warn({ err, url }, 'fetch_url failed')
      return { error: err instanceof Error ? err.message : 'Fetch failed' }
    } finally {
      clearTimeout(timer)
    }
  },
})
