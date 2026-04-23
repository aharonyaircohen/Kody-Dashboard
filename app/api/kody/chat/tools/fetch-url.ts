/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Fetches a URL via Jina Reader (r.jina.ai), which runs a
 *  headless browser server-side and returns JS-rendered page content as
 *  clean markdown. Falls through as plain HTTP for edge cases. Replaces
 *  Gemini's URL Context, which Gemini forbids mixing with custom tools.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { logger } from '@dashboard/lib/logger'

const MAX_TEXT = 30_000
const FETCH_TIMEOUT_MS = 30_000 // Jina's JS-render path is slower than raw HTTP

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

interface JinaResponse {
  code?: number
  status?: number
  data?: {
    title?: string
    description?: string
    url?: string
    content?: string
  }
}

export const fetchUrlTool = tool({
  description:
    'Fetch a public http(s) URL and return the fully rendered page as ' +
    'markdown. Works on JavaScript-heavy SPAs. Use this when the user ' +
    'shares a link and wants you to read it.',
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

    const apiKey = process.env.JINA_API_KEY
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return {
          error: `Jina Reader returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
        }
      }

      const json = (await res.json()) as JinaResponse
      const data = json.data ?? {}
      let content = data.content ?? ''
      const truncated = content.length > MAX_TEXT
      if (truncated) {
        content = `${content.slice(0, MAX_TEXT)}\n\n[... truncated ${content.length - MAX_TEXT} chars ...]`
      }

      return {
        url: data.url ?? url,
        status: res.status,
        title: data.title ?? null,
        description: data.description ?? null,
        content,
        truncated,
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { error: 'Request timed out after 30s' }
      }
      logger.warn({ err, url }, 'fetch_url failed')
      return { error: err instanceof Error ? err.message : 'Fetch failed' }
    } finally {
      clearTimeout(timer)
    }
  },
})
