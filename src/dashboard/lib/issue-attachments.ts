/**
 * @fileType lib
 * @domain kody
 * @pattern issue-attachment-extractor
 *
 * Extracts and downloads GitHub issue attachments (images, files, logs, etc.)
 * from an issue's body and comments so they can be forwarded to the Brain chat
 * server as multimodal content. Matches GitHub's standard attachment CDN URL
 * shapes. Returns base64-encoded payloads with detected MIME types.
 */

import { fetchIssue, fetchComments } from './github-client'

export interface IssueAttachment {
  name: string
  mimeType: string
  /** Raw base64 (no data-URL prefix). */
  data: string
}

const ATTACHMENT_URL_RE =
  /https:\/\/(?:user-images\.githubusercontent\.com|github\.com\/user-attachments|github\.com\/[^/\s]+\/[^/\s]+\/assets)\/[^\s)"'>\]]+/gi

const MAX_PER_FILE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

function extractUrls(text: string | null | undefined): string[] {
  if (!text) return []
  return Array.from(new Set(text.match(ATTACHMENT_URL_RE) ?? []))
}

function deriveName(url: string, mimeType: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() ?? 'attachment'
    if (last.includes('.')) return last
    const ext = mimeType.split('/')[1]?.split(';')[0]
    return ext ? `${last}.${ext}` : last
  } catch {
    return 'attachment'
  }
}

async function downloadAttachment(url: string): Promise<IssueAttachment | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const token = process.env.GITHUB_TOKEN
    const headers: Record<string, string> = { 'User-Agent': 'Kody-Dashboard' }
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) return null
    const mimeType =
      res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
    if (!mimeType.startsWith('image/')) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > MAX_PER_FILE_BYTES) return null
    return {
      name: deriveName(url, mimeType),
      mimeType,
      data: Buffer.from(buf).toString('base64'),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch every GitHub-hosted attachment referenced in an issue's body and
 * comments and return them as base64 payloads. Silently drops URLs that fail
 * to fetch, exceed per-file size, or would push the batch past the total cap.
 */
export async function fetchIssueAttachments(issueNumber: number): Promise<IssueAttachment[]> {
  try {
    const [issue, comments] = await Promise.all([
      fetchIssue(issueNumber),
      fetchComments(issueNumber),
    ])
    const sources: string[] = []
    if (issue?.body) sources.push(issue.body)
    for (const c of comments) sources.push(c.body)

    const urls = Array.from(new Set(sources.flatMap(extractUrls)))
    if (urls.length === 0) return []

    const downloaded = await Promise.all(urls.map(downloadAttachment))
    const kept: IssueAttachment[] = []
    let total = 0
    for (const a of downloaded) {
      if (!a) continue
      const bytes = Math.ceil((a.data.length * 3) / 4)
      if (total + bytes > MAX_TOTAL_BYTES) break
      total += bytes
      kept.push(a)
    }
    return kept
  } catch {
    return []
  }
}
