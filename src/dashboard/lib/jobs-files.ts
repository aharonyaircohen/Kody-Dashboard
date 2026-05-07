/**
 * Job file storage — read/write `.kody/jobs/<slug>.md` via the
 * GitHub contents API. Replaces the issue-as-job model.
 *
 * One file per job. Path is the source of truth for identity (slug),
 * file body is the job's markdown. Metadata (title, lastModified, sha)
 * is derived from the file itself and the GitHub commit history is the audit
 * trail — no labels, no issue tracker.
 */

import type { Octokit } from '@octokit/rest'
import { getOctokit, getOwner, getRepo, invalidateJobsCache } from './github-client'

export interface JobFile {
  /** Filename without `.md` — stable identity. */
  slug: string
  /** First H1 of the body, or humanized slug fallback. */
  title: string
  /** Markdown body (post-H1 if present, else the entire file). */
  body: string
  /** Git blob sha. Required for update/delete. Returned by reads only. */
  sha: string
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string
  /** Convenience link to the file on github.com. */
  htmlUrl: string
}

const JOBS_DIR = '.kody/jobs'

function slugFromName(name: string): string | null {
  if (!name.endsWith('.md')) return null
  const slug = name.slice(0, -'.md'.length)
  if (slug.length === 0 || slug.startsWith('.') || slug.startsWith('_')) return null
  return slug
}

function isValidSlug(slug: string): boolean {
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
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${JOBS_DIR}/${slug}.md`
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
    return data[0]?.commit.committer?.date ?? data[0]?.commit.author?.date ?? new Date().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/**
 * List every job file under `.kody/jobs/`. Returns `[]` if the
 * directory does not exist (fresh repo).
 */
export async function listJobFiles(): Promise<JobFile[]> {
  const octokit = getOctokit()
  const branch = await getDefaultBranch(octokit).catch(() => null)

  let entries: Array<{ name: string; sha: string; type: string }> = []
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: JOBS_DIR,
    })
    if (!Array.isArray(data)) return []
    entries = data as Array<{ name: string; sha: string; type: string }>
  } catch (error: any) {
    if (error?.status === 404) return []
    throw error
  }

  const slugs = entries
    .filter((e) => e.type === 'file')
    .map((e) => ({ slug: slugFromName(e.name), sha: e.sha, name: e.name }))
    .filter((e): e is { slug: string; sha: string; name: string } => e.slug !== null)

  const files = await Promise.all(
    slugs.map(async ({ slug, sha, name }) => {
      try {
        const filePath = `${JOBS_DIR}/${name}`
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
          sha,
          updatedAt,
          htmlUrl: buildHtmlUrl(slug, branch),
        } satisfies JobFile
      } catch {
        return null
      }
    }),
  )

  return files.filter((f): f is JobFile => f !== null).sort((a, b) => a.slug.localeCompare(b.slug))
}

/**
 * Read a single job file by slug. Returns `null` if the file does not
 * exist.
 */
export async function readJobFile(slug: string): Promise<JobFile | null> {
  if (!isValidSlug(slug)) return null
  const octokit = getOctokit()
  const branch = await getDefaultBranch(octokit).catch(() => null)
  const filePath = `${JOBS_DIR}/${slug}.md`

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
      sha: data.sha,
      updatedAt,
      htmlUrl: buildHtmlUrl(slug, branch),
    }
  } catch (error: any) {
    if (error?.status === 404) return null
    throw error
  }
}

interface WriteOptions {
  octokit: Octokit
  slug: string
  title: string
  body: string
  /** SHA of the existing blob; omit on create. */
  sha?: string
  /** Commit message override. */
  message?: string
}

function buildFileContent(title: string, body: string): string {
  const trimmedBody = body.replace(/^\s+/, '')
  return `# ${title.trim()}\n\n${trimmedBody}${trimmedBody.endsWith('\n') ? '' : '\n'}`
}

/**
 * Create or update a job file. Use `sha` for updates; omit for creates.
 * Returns the new file's JobFile record.
 */
export async function writeJobFile(opts: WriteOptions): Promise<JobFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(`Invalid job slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`)
  }
  const filePath = `${JOBS_DIR}/${opts.slug}.md`
  const content = buildFileContent(opts.title, opts.body)
  const message = opts.message ?? `${opts.sha ? 'chore' : 'feat'}(jobs): ${opts.sha ? 'update' : 'add'} ${opts.slug}`

  await opts.octokit.repos.createOrUpdateFileContents({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    sha: opts.sha,
  })

  invalidateJobsCache(opts.slug)
  const refreshed = await readJobFile(opts.slug)
  if (!refreshed) {
    throw new Error('writeJobFile: file was written but could not be re-read')
  }
  return refreshed
}

/**
 * Delete a job file. Idempotent on already-missing files (no-op).
 */
export async function deleteJobFile(octokit: Octokit, slug: string): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid job slug: "${slug}".`)
  }
  const existing = await readJobFile(slug)
  if (!existing) return
  const filePath = `${JOBS_DIR}/${slug}.md`
  await octokit.repos.deleteFile({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message: `chore(jobs): remove ${slug}`,
    sha: existing.sha,
  })
  invalidateJobsCache(slug)
}

export { isValidSlug }
