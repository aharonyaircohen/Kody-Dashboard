/**
 * @fileType utility
 * @domain kody
 * @pattern reports-files
 * @ai-summary Read-only access to system reports under `.kody/reports/<slug>.md`
 *   in the connected repo. Reports are produced by Kody jobs (doc-drift,
 *   coverage-floor, etc.) — the dashboard surfaces them as a health view.
 *   No write operations: the engine owns this directory.
 */

import type { Octokit } from '@octokit/rest'
import { getOctokit, getOwner, getRepo } from './github-client'

export interface ReportFile {
  /** Filename without `.md` — stable identity. */
  slug: string
  /** First H1 of the body, or humanized slug fallback. */
  title: string
  /** Markdown body (post-H1 if present, else the entire file). */
  body: string
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string
  /** Convenience link to the file on github.com. */
  htmlUrl: string
  /** Size in bytes (helps preview length without fetching body). */
  size: number
}

const REPORTS_DIR = '.kody/reports'

function slugFromName(name: string): string | null {
  if (!name.endsWith('.md')) return null
  const slug = name.slice(0, -'.md'.length)
  if (slug.length === 0 || slug.startsWith('.') || slug.startsWith('_')) return null
  return slug
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)
}

function deriveTitle(body: string, slug: string): string {
  const firstLine = body.trimStart().split('\n', 1)[0] ?? ''
  const h1 = /^#\s+(.+?)\s*$/.exec(firstLine)
  if (h1) return h1[1]!.trim()
  return slug
    .split(/[-_]+/)
    .filter((s) => s.length > 0)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join(' ')
}

function stripLeadingH1(body: string): string {
  const trimmed = body.replace(/^﻿/, '')
  const lines = trimmed.split('\n')
  if (lines.length > 0 && /^#\s+.+/.test(lines[0]!)) {
    return lines.slice(1).join('\n').replace(/^\n+/, '')
  }
  return trimmed
}

function buildHtmlUrl(slug: string, branch: string | null): string {
  const ref = branch ?? 'HEAD'
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${REPORTS_DIR}/${slug}.md`
}

async function getDefaultBranch(octokit: Octokit): Promise<string> {
  const { data } = await octokit.repos.get({ owner: getOwner(), repo: getRepo() })
  return data.default_branch
}

async function fetchLastCommitDate(
  octokit: Octokit,
  filePath: string,
): Promise<string> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      per_page: 1,
    })
    return (
      data[0]?.commit.committer?.date ??
      data[0]?.commit.author?.date ??
      new Date().toISOString()
    )
  } catch {
    return new Date().toISOString()
  }
}

/**
 * List every report under `.kody/reports/`. Returns `[]` if the
 * directory does not exist (fresh repo).
 */
export async function listReportFiles(): Promise<ReportFile[]> {
  const octokit = getOctokit()
  const branch = await getDefaultBranch(octokit).catch(() => null)

  let entries: Array<{ name: string; sha: string; type: string; size: number }> = []
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: REPORTS_DIR,
    })
    if (!Array.isArray(data)) return []
    entries = data as Array<{ name: string; sha: string; type: string; size: number }>
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return []
    throw error
  }

  const slugs = entries
    .filter((e) => e.type === 'file')
    .map((e) => ({ slug: slugFromName(e.name), name: e.name, size: e.size }))
    .filter((e): e is { slug: string; name: string; size: number } => e.slug !== null)

  const files = await Promise.all(
    slugs.map(async ({ slug, name, size }) => {
      try {
        const filePath = `${REPORTS_DIR}/${name}`
        const { data } = await octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: filePath,
        })
        if (Array.isArray(data) || !('content' in data) || !data.content) return null
        const raw = Buffer.from(data.content, 'base64').toString('utf-8')
        const body = stripLeadingH1(raw)
        const title = deriveTitle(raw, slug)
        const updatedAt = await fetchLastCommitDate(octokit, filePath)
        return {
          slug,
          title,
          body,
          updatedAt,
          htmlUrl: buildHtmlUrl(slug, branch),
          size,
        } satisfies ReportFile
      } catch {
        return null
      }
    }),
  )

  // Most recently updated first — reports are time-sensitive health signals.
  return files
    .filter((f): f is ReportFile => f !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Read a single report by slug. Returns `null` if the file does not exist.
 */
export async function readReportFile(slug: string): Promise<ReportFile | null> {
  if (!isValidSlug(slug)) return null
  const octokit = getOctokit()
  const branch = await getDefaultBranch(octokit).catch(() => null)
  const filePath = `${REPORTS_DIR}/${slug}.md`

  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
    })
    if (Array.isArray(data) || !('content' in data) || !data.content) return null
    const raw = Buffer.from(data.content, 'base64').toString('utf-8')
    const body = stripLeadingH1(raw)
    const title = deriveTitle(raw, slug)
    const updatedAt = await fetchLastCommitDate(octokit, filePath)
    return {
      slug,
      title,
      body,
      updatedAt,
      htmlUrl: buildHtmlUrl(slug, branch),
      size: typeof data.size === 'number' ? data.size : raw.length,
    }
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null
    throw error
  }
}
