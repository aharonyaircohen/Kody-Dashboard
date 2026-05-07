/**
 * Job file storage — read/write `.kody/jobs/<slug>.md` via the
 * GitHub contents API. Replaces the issue-as-job model.
 *
 * One file per job. Path is the source of truth for identity (slug),
 * file body is the job's markdown. Metadata (title, lastModified, sha)
 * is derived from the file itself and the GitHub commit history is the audit
 * trail — no labels, no issue tracker.
 *
 * Legacy: jobs were previously stored under `.kody/missions/`. We read from
 * both directories (jobs/ wins on slug conflict) and writes preserve the
 * existing file's location, so a job edited in-place migrates to the new
 * directory only after an explicit migration. Run `pnpm jobs:migrate-files`
 * to move all `.kody/missions/*.md` files to `.kody/jobs/*.md` in one shot.
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
  /** True if this job is still living under the legacy `.kody/missions/` path. */
  legacy: boolean
}

const JOBS_DIR = '.kody/jobs'
const LEGACY_DIR = '.kody/missions'

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

function buildHtmlUrl(dir: string, slug: string, branch: string | null): string {
  const ref = branch ?? 'HEAD'
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${dir}/${slug}.md`
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

async function listDirEntries(
  octokit: Octokit,
  dir: string,
): Promise<Array<{ name: string; sha: string }>> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: dir,
    })
    if (!Array.isArray(data)) return []
    return (data as Array<{ name: string; sha: string; type: string }>)
      .filter((e) => e.type === 'file')
      .map((e) => ({ name: e.name, sha: e.sha }))
  } catch (error: any) {
    if (error?.status === 404) return []
    throw error
  }
}

async function readFromDir(
  octokit: Octokit,
  dir: string,
  slug: string,
  branch: string | null,
  legacy: boolean,
): Promise<JobFile | null> {
  const filePath = `${dir}/${slug}.md`
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
      htmlUrl: buildHtmlUrl(dir, slug, branch),
      legacy,
    }
  } catch (error: any) {
    if (error?.status === 404) return null
    throw error
  }
}

/**
 * List every job file. Reads `.kody/jobs/` and `.kody/missions/` (legacy)
 * and merges them; jobs/ wins on slug conflict. Returns `[]` if both
 * directories are empty/missing.
 */
export async function listJobFiles(): Promise<JobFile[]> {
  const octokit = getOctokit()
  const branch = await getDefaultBranch(octokit).catch(() => null)

  const [primary, legacy] = await Promise.all([
    listDirEntries(octokit, JOBS_DIR),
    listDirEntries(octokit, LEGACY_DIR),
  ])

  type Entry = { slug: string; sha: string; name: string; dir: string; legacy: boolean }
  const seen = new Map<string, Entry>()

  for (const e of primary) {
    const slug = slugFromName(e.name)
    if (slug) seen.set(slug, { slug, sha: e.sha, name: e.name, dir: JOBS_DIR, legacy: false })
  }
  for (const e of legacy) {
    const slug = slugFromName(e.name)
    if (slug && !seen.has(slug)) {
      seen.set(slug, { slug, sha: e.sha, name: e.name, dir: LEGACY_DIR, legacy: true })
    }
  }

  const files = await Promise.all(
    Array.from(seen.values()).map(async ({ slug, sha, name, dir, legacy: isLegacy }) => {
      try {
        const filePath = `${dir}/${name}`
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
          htmlUrl: buildHtmlUrl(dir, slug, branch),
          legacy: isLegacy,
        } satisfies JobFile
      } catch {
        return null
      }
    }),
  )

  return files
    .filter((f): f is JobFile => f !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

/**
 * Read a single job file by slug. Tries `.kody/jobs/` first, then falls
 * back to `.kody/missions/`. Returns `null` if neither location has it.
 */
export async function readJobFile(slug: string): Promise<JobFile | null> {
  if (!isValidSlug(slug)) return null
  const octokit = getOctokit()
  const branch = await getDefaultBranch(octokit).catch(() => null)
  const fromPrimary = await readFromDir(octokit, JOBS_DIR, slug, branch, false)
  if (fromPrimary) return fromPrimary
  return readFromDir(octokit, LEGACY_DIR, slug, branch, true)
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
 * Create or update a job file. Updates preserve the file's existing
 * directory (jobs/ vs missions/) so legacy files don't duplicate. New
 * files always go to `.kody/jobs/`.
 */
export async function writeJobFile(opts: WriteOptions): Promise<JobFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(`Invalid job slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`)
  }

  let dir = JOBS_DIR
  if (opts.sha) {
    const existing = await readJobFile(opts.slug)
    if (existing?.legacy) dir = LEGACY_DIR
  }

  const filePath = `${dir}/${opts.slug}.md`
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
 * Delete a job file. Idempotent on already-missing files. Removes from
 * whichever directory currently holds the file (jobs/ or legacy missions/).
 */
export async function deleteJobFile(octokit: Octokit, slug: string): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid job slug: "${slug}".`)
  }
  const existing = await readJobFile(slug)
  if (!existing) return
  const dir = existing.legacy ? LEGACY_DIR : JOBS_DIR
  const filePath = `${dir}/${slug}.md`
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
