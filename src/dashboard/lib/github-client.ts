/**
 * @fileType utility
 * @domain kody
 * @pattern github-client
 * @ai-summary GitHub API client with caching and manual rate limit handling
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { throttling } from '@octokit/plugin-throttling'
import { Octokit } from '@octokit/rest'
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  WORKFLOW_ID,
  BRANCH_PREFIXES,
  CACHE_TTL,
  BRANCH_CACHE_TTL,
  TASK_ID_REGEX,
  ALL_STAGES,
} from './constants'
import type {
  KodyPipelineStatus,
  GitHubIssue,
  GitHubComment,
  WorkflowRun,
  GitHubPR,
  GitHubCollaborator,
  CheckRunResult,
  PRComment,
  FileChange,
  TaskDocument,
} from './types'

// ============ Types ============

interface CacheEntry<T> {
  data: T
  expires: number
  etag?: string // ETag from GitHub for conditional requests
  lastModified?: string // Last-Modified header
}

// ============ Cache ============

const cache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (entry && entry.expires > Date.now()) {
    return entry.data as T
  }
  // Keep expired entries so their ETag survives for conditional GETs.
  // The next setCache (or invalidateCache) will overwrite / evict them.
  return null
}

/**
 * Return a stale (expired) cache entry + its ETag, for use with
 * `If-None-Match` conditional GitHub requests. Returning 304 (free — does
 * not count against the rate limit) lets us refresh the TTL on the existing
 * data without re-downloading it.
 */
function getStale<T>(key: string): { data: T; etag?: string } | null {
  const entry = cache.get(key)
  return entry ? { data: entry.data as T, etag: entry.etag } : null
}

/**
 * Get cached data along with its ETag for conditional requests
 */
function setCache<T>(
  key: string,
  ttl: number,
  data: T,
  options?: { etag?: string; lastModified?: string },
): void {
  cache.set(key, {
    data,
    expires: Date.now() + ttl,
    etag: options?.etag,
    lastModified: options?.lastModified,
  })
}

/**
 * Invalidate specific cache keys by prefix
 * More targeted than clearing the entire cache
 */
function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key)
    }
  }
}

/**
 * Targeted cache invalidation by category
 * Instead of clearing everything, only clear relevant caches
 */
export function invalidateTaskCache(): void {
  invalidateCache('issues:')
  invalidateCache('issue:')
  invalidateCache('workflows:')
}

export function invalidatePRCache(): void {
  invalidateCache('pr:')
  invalidateCache('pr-')
  invalidateCache('open-prs:')
  invalidateCache('previews:')
}

export function invalidateBoardCache(): void {
  invalidateCache('boards:')
  invalidateCache('labels:')
  invalidateCache('milestones:')
}

export function invalidateBranchCache(): void {
  invalidateCache('branch:')
  invalidateCache('branches:')
  invalidateCache('refs:')
}

/**
 * Invalidate cache entries for a single issue plus every cached issues listing.
 * Use after a write that mutates an issue (or a manifest stored in an issue),
 * so the next read on this serverless instance picks up the change without
 * waiting for the TTL.
 */
export function invalidateIssueCache(issueNumber?: number): void {
  if (typeof issueNumber === 'number') {
    cache.delete(`issue:${issueNumber}`)
  }
  invalidateCache('issues:')
}

// ============ Per-Request Repo Context ============
//
// The dashboard supports per-user repos (user logs in with their own GitHub token
// and a target repo). These variables hold the current request's repo context.
// In Vercel serverless (Fluid Compute), each request is processed sequentially,
// so this module-level state is safe as long as routes clear it after use.

let _owner: string = GITHUB_OWNER
let _repo: string = GITHUB_REPO
let _octokit: Octokit | null = null

export function getOwner(): string {
  return _owner
}

export function getRepo(): string {
  return _repo
}

/**
 * Set the repo context for the current request.
 * API routes MUST call this before any github-client calls and clearRepoContext() after.
 *
 * @param owner - GitHub repo owner (e.g. "aharonyaircohen")
 * @param repo  - GitHub repo name (e.g. "Kody-ADE-Engine")
 * @param token - GitHub token (user's PAT). Falls back to env token if omitted.
 */
export function setGitHubContext(owner: string, repo: string, token?: string): void {
  _owner = owner
  _repo = repo

  const authToken = token ?? process.env.KODY_BOT_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_PAT ?? null
  if (!authToken) {
    throw new Error('No GitHub token configured. Set KODY_BOT_TOKEN, GITHUB_TOKEN, or GH_PAT.')
  }

  const MyOctokit = Octokit.plugin(throttling)
  _octokit = new MyOctokit({
    auth: authToken,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        if (_options.request?.headers?.['x-octokit-retry-count'] === 0) {
          console.warn(`[Kody] Rate limited, retrying after ${retryAfter}s`)
          return true
        }
        console.error(`[Kody] Rate limit hit twice, giving up`)
        return false
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        const retryCount = (_options.request?.retryCount as number) ?? 0
        if (retryCount < 2) {
          console.warn(`[Kody] Secondary rate limit, retrying after ${retryAfter}s (attempt ${retryCount + 1}/2)`)
          return true
        }
        console.error(`[Kody] Secondary rate limit hit ${retryCount + 1} times, giving up`)
        return false
      },
    },
  })
}

export function clearGitHubContext(): void {
  _owner = getOwner()
  _repo = getRepo()
  _octokit = null
}

// ============ Octokit Singleton ============

let octokitInstance: Octokit | null = null

type ThrottledOctokit = Octokit & ReturnType<typeof throttling>

export function getOctokit(): Octokit {
  // Use the per-request context Octokit when set (via setGitHubContext)
  if (_octokit) return _octokit as ThrottledOctokit
  if (octokitInstance) return octokitInstance as ThrottledOctokit

  // Prefer KODY_BOT_TOKEN if set (for bot attribution), otherwise fall back to GITHUB_TOKEN / GH_PAT
  const token = process.env.KODY_BOT_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_PAT
  if (!token) {
    throw new Error('No GitHub token configured. Set KODY_BOT_TOKEN, GITHUB_TOKEN, or GH_PAT.')
  }

  // Create Octokit with throttling plugin - auto-retries on rate limits
  const MyOctokit = Octokit.plugin(throttling)
  octokitInstance = new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        // Retry once after rate limit, then stop
        if (_options.request?.headers?.['x-octokit-retry-count'] === 0) {
          console.warn(`[Kody] Rate limited, retrying after ${retryAfter}s`)
          return true
        }
        console.error(`[Kody] Rate limit hit twice, giving up`)
        return false
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        // Secondary rate limit (abuse detection) — retry up to 2 times, then stop to avoid token ban
        const retryCount = (_options.request?.retryCount as number) ?? 0
        if (retryCount < 2) {
          console.warn(
            `[Kody] Secondary rate limit, retrying after ${retryAfter}s (attempt ${retryCount + 1}/2)`,
          )
          return true
        }
        console.error(
          `[Kody] Secondary rate limit hit ${retryCount + 1} times, giving up to avoid token ban`,
        )
        return false
      },
    },
  })

  return octokitInstance as ThrottledOctokit
}

/**
 * Create a per-request Octokit instance for a user's GitHub token.
 * Used for write operations so they appear under the user's identity.
 * Does NOT cache — each call creates a fresh instance.
 */
export function createUserOctokit(token: string): Octokit {
  const MyOctokit = Octokit.plugin(throttling)
  return new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        if (_options.request?.headers?.['x-octokit-retry-count'] === 0) {
          console.warn(`[Kody/User] Rate limited, retrying after ${retryAfter}s`)
          return true
        }
        console.error(`[Kody/User] Rate limit hit twice, giving up`)
        return false
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        console.warn(`[Kody/User] Secondary rate limit, retrying after ${retryAfter}s`)
        return true
      },
    },
  })
}

// ============ Branch Discovery ============

/**
 * Load (and cache) the full list of branches under a prefix. Cached for
 * BRANCH_CACHE_TTL so subsequent lookups hit memory, not the GitHub API.
 * Shared by findTaskBranch and findBranchesByIssueNumbers.
 */
async function getBranchesForPrefix(prefix: string): Promise<string[]> {
  const cacheKey = `branches:prefix:${prefix}`
  const cached = getCached<string[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()
  try {
    const { data } = await octokit.git.listMatchingRefs({
      owner: getOwner(),
      repo: getRepo(),
      ref: `heads/${prefix}/`,
    })
    const branches = data.map((ref: any) => ref.ref.replace('refs/heads/', ''))
    setCache(cacheKey, BRANCH_CACHE_TTL, branches)
    return branches
  } catch {
    return []
  }
}

/**
 * Find the branch for a task across all known prefixes.
 * Uses cached per-prefix listings — on a warm cache this makes zero API calls.
 */
export async function findTaskBranch(taskId: string): Promise<string | null> {
  if (!TASK_ID_REGEX.test(taskId)) {
    return null
  }

  const cacheKey = `branch:task:${taskId}`
  const cached = getCached<string | null>(cacheKey)
  if (cached !== null) return cached

  const results = await Promise.all(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix)
      const exact = `${prefix}/${taskId}`
      const withSuffix = `${prefix}/${taskId}-`
      return (
        branches.find((b) => b === exact || b.startsWith(withSuffix)) ?? null
      )
    }),
  )

  const found = results.find((r) => r !== null) ?? null
  setCache(cacheKey, BRANCH_CACHE_TTL, found)
  return found
}

/**
 * Find a branch by issue number.
 * The pipeline convention includes the issue number in the branch name:
 *   {prefix}/{YYMMDD}-auto-{issueNumber}-{sanitized-title}
 * We search across all known prefixes using the matching-refs API.
 */
export async function findBranchByIssueNumber(
  issueNumber: string | number,
): Promise<string | null> {
  const cacheKey = `branch:issue:${issueNumber}`
  const cached = getCached<string>(cacheKey)
  if (cached) return cached

  const issueStr = String(issueNumber)
  const pattern = new RegExp(`-${issueStr}-`)

  // Reuse the shared prefix-branch cache
  const results = await Promise.all(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix)
      return branches.find((b) => pattern.test(b)) ?? null
    }),
  )

  const found = results.find((r) => r !== null) ?? null
  if (found) setCache(cacheKey, BRANCH_CACHE_TTL, found)
  return found
}

/**
 * Fetch branches for multiple issue numbers in a single batch.
 * Makes 5 listMatchingRefs calls (one per prefix) instead of 5*N calls.
 * Returns a map of issueNumber -> branchName.
 *
 * Also caches the full branch list per prefix to avoid redundant calls on subsequent polls.
 */
export async function findBranchesByIssueNumbers(
  issueNumbers: (string | number)[],
): Promise<Map<number, string>> {
  if (issueNumbers.length === 0) return new Map()

  const result = new Map<number, string>()
  const issueStrs = issueNumbers.map((n) => String(n))

  // Fetch (or hit cache for) each prefix's branch list in parallel
  void (await Promise.allSettled(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix)

      for (const issueStr of issueStrs) {
        const pattern = new RegExp(`-${issueStr}-`)
        const match = branches.find((branchName) => pattern.test(branchName))
        if (match) {
          const issueNum = parseInt(issueStr, 10)
          if (!result.has(issueNum)) {
            result.set(issueNum, match)
            const individualCacheKey = `branch:issue:${issueStr}`
            setCache(individualCacheKey, BRANCH_CACHE_TTL, match)
          }
        }
      }
    }),
  ))

  return result
}

// ============ Status JSON Access ============

/**
 * Normalize pipeline status data from v2 format.
 * - Derives `currentStage` from stages data if not set (finds the running stage)
 * - Maps `cursor` field to `currentStage` as fallback
 */
export function normalizePipelineStatus(status: KodyPipelineStatus): KodyPipelineStatus {
  let currentStage = status.currentStage

  // If currentStage is not set, derive it from stages data
  if (!currentStage && status.stages) {
    const stageEntries = Object.entries(status.stages)

    // 1. Find a stage that is currently running
    const runningEntry = stageEntries.find(([, data]) => data.state === 'running')
    if (runningEntry) {
      currentStage = runningEntry[0]
    }

    // 2. Find a paused stage (pipeline gated)
    if (!currentStage) {
      const pausedEntry = stageEntries.find(([, data]) => data.state === 'paused')
      if (pausedEntry) {
        currentStage = pausedEntry[0]
      }
    }

    // 3. Derive from stage completion: walk ALL_STAGES in order,
    //    find the first stage with data that is NOT completed/skipped (= where we are now).
    //    Stages without data entries are skipped (they may not be tracked).
    if (!currentStage) {
      for (const stage of ALL_STAGES) {
        const data = status.stages[stage]
        if (!data) continue // Stage not tracked — skip
        if (data.state !== 'completed' && data.state !== 'skipped') {
          // This stage hasn't finished — it's the current position
          currentStage = stage
          break
        }
      }
    }

    // 4. If ALL known stages are completed/skipped, use the last completed stage
    if (!currentStage && stageEntries.length > 0) {
      let lastCompleted: string | null = null
      for (const stage of ALL_STAGES) {
        const data = status.stages[stage]
        if (data && (data.state === 'completed' || data.state === 'skipped')) {
          lastCompleted = stage
        }
      }
      if (lastCompleted) {
        currentStage = lastCompleted
      }
    }
  }

  return {
    ...status,
    currentStage,
  }
}

/**
 * Read status.json from a branch
 */
export async function getStatusFromBranch(
  taskId: string,
  branch: string,
): Promise<KodyPipelineStatus | null> {
  const cacheKey = `status:branch:${taskId}:${branch}`
  const cached = getCached<KodyPipelineStatus>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: `.tasks/${taskId}/status.json`,
      ref: branch,
    })

    if ('content' in data && data.content) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8')
      const raw = JSON.parse(content) as KodyPipelineStatus
      const status = normalizePipelineStatus(raw)
      setCache(cacheKey, CACHE_TTL.pipeline, status)
      return status
    }
  } catch (error: any) {
    if (error.status !== 404) {
      console.error('[Kody] Error fetching status from branch:', error)
    }
  }

  return null
}

/**
 * Discover and read status.json from a branch by scanning the .tasks/ directory.
 * The pipeline creates task IDs with random counters (e.g., 260306-auto-330) that
 * don't match the issue number, so we can't guess the task ID from the issue.
 * Instead, we list .tasks/ on the branch and find the newest YYMMDD-prefixed directory.
 */
export async function findStatusOnBranch(
  branch: string,
  issueNumber?: number,
): Promise<KodyPipelineStatus | null> {
  const cacheKey = `status:discover:${branch}:${issueNumber ?? 'any'}`
  const cached = getCached<KodyPipelineStatus>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    // List .tasks/ directory on the branch
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: '.tasks',
      ref: branch,
    })

    if (!Array.isArray(data)) return null

    // Find directories matching YYMMDD-* pattern (pipeline task IDs)
    const taskDirs = data
      .filter((item: any) => item.type === 'dir' && TASK_ID_REGEX.test(item.name))
      .map((item: any) => item.name)
      .sort()
      .reverse() // Newest first (YYMMDD sorts chronologically)

    // Try the newest task directory first (check up to 3).
    // When issueNumber is provided, skip status files belonging to different issues
    // (branches can accumulate status.json files from multiple pipeline runs).
    for (const taskDir of taskDirs.slice(0, 3)) {
      const status = await getStatusFromBranch(taskDir, branch)
      if (status) {
        if (issueNumber && status.issueNumber && status.issueNumber !== issueNumber) continue
        return status
      }
    }
  } catch (error: any) {
    if (error.status !== 404) {
      console.error('[Kody] Error listing .tasks/ on branch:', error)
    }
  }

  return null
}

/**
 * Read status.json from an artifact
 */
export async function getStatusFromArtifact(
  taskId: string,
  runId: string,
): Promise<KodyPipelineStatus | null> {
  const cacheKey = `status:artifact:${taskId}:${runId}`
  const cached = getCached<KodyPipelineStatus>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    // Find artifact
    const { data: artifacts } = await octokit.actions.listWorkflowRunArtifacts({
      owner: getOwner(),
      repo: getRepo(),
      run_id: parseInt(runId),
    })

    const artifact = artifacts.artifacts.find(
      (a: { name: string }) => a.name === `kody-${taskId}-${runId}`,
    )

    if (!artifact) {
      return null
    }

    // Download artifact
    await octokit.actions.downloadArtifact({
      owner: getOwner(),
      repo: getRepo(),
      artifact_id: artifact.id,
      archive_format: 'zipball',
    })

    // Note: In a real implementation, we'd need to extract the zip and parse status.json
    // For now, return null as this requires additional handling
    console.log('[Kody] Artifact download not fully implemented')
    return null
  } catch (error: any) {
    if (error.status !== 404) {
      console.error('[Kody] Error fetching status from artifact:', error)
    }
  }

  return null
}

// ============ Issue & Comment Fetching ============

/**
 * Fetch a single issue by number (optimized for detail view).
 *
 * Caching:
 * - Default TTL is `CACHE_TTL.tasks` (2min). Pass `ttl` to shorten it for
 *   endpoints that need fresher data (e.g. goals manifest, missions detail).
 * - When the TTL expires, the cached ETag is replayed via `If-None-Match`.
 *   GitHub returns 304 (free, doesn't count against the rate limit) when the
 *   issue is unchanged, and we just refresh the TTL on the existing payload.
 * - `noCache` skips the cache entirely (rarely needed; prefer `ttl`).
 */
export async function fetchIssue(
  issueNumber: number,
  options?: { noCache?: boolean; ttl?: number },
): Promise<GitHubIssue | null> {
  const cacheKey = `issue:${issueNumber}`
  const ttl = options?.ttl ?? CACHE_TTL.tasks

  if (!options?.noCache) {
    const cached = getCached<GitHubIssue>(cacheKey)
    if (cached) return cached
  }

  const stale = options?.noCache ? null : getStale<GitHubIssue>(cacheKey)
  const octokit = getOctokit()

  let response
  try {
    response = await octokit.issues.get({
      owner: getOwner(),
      repo: getRepo(),
      issue_number: issueNumber,
      headers: stale?.etag ? { 'If-None-Match': stale.etag } : undefined,
    })
  } catch (error: any) {
    if (error.status === 304 && stale) {
      setCache(cacheKey, ttl, stale.data, { etag: stale.etag })
      return stale.data
    }
    if (error.status === 404) {
      return null
    }
    throw error
  }

  const data = response.data
  const newEtag = (response.headers as Record<string, string | undefined>)?.etag

  const issue: GitHubIssue = {
    id: data.id,
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    state: data.state as 'open' | 'closed',
    labels: data.labels.map((l: any) =>
      typeof l === 'string'
        ? { name: l, color: '000000' }
        : { name: l.name ?? '', color: l.color ?? '000000' },
    ),
    milestone: data.milestone ? { title: data.milestone.title ?? '' } : null,
    assignees:
      data.assignees?.map((a: any) => ({
        login: a.login ?? '',
        avatar_url: a.avatar_url ?? '',
      })) ?? [],
    created_at: data.created_at ?? '',
    updated_at: data.updated_at ?? '',
    closed_at: data.closed_at ?? null,
    html_url: data.html_url ?? '',
    isKodyAssigned:
      data.assignees?.some(
        (a: any) =>
          a.login === 'github-actions[bot]' || a.login === 'Copilot' || (a as any).type === 'Bot',
      ) ?? false,
  }

  if (!options?.noCache) {
    setCache(cacheKey, ttl, issue, { etag: newEtag })
  }
  return issue
}

/**
 * Fetch issues with optional filters.
 *
 * Caching:
 * - Default TTL is `CACHE_TTL.tasks` (2min). Pass `ttl` to shorten it for
 *   endpoints that need fresher data (e.g. goals/missions list).
 * - Post-TTL revalidation replays the cached ETag via `If-None-Match`. GitHub
 *   returns 304 (free, doesn't count against the rate limit) when the listing
 *   is unchanged, and the TTL is refreshed on the existing payload.
 * - `noCache` skips the cache entirely (rarely needed; prefer `ttl`).
 */
export async function fetchIssues(options?: {
  state?: 'open' | 'closed' | 'all'
  labels?: string
  excludeLabels?: string[]
  milestone?: number
  perPage?: number
  since?: string // ISO 8601 date string - only returns issues updated after this date
  ttl?: number
  noCache?: boolean
}): Promise<GitHubIssue[]> {
  const { noCache, ttl: ttlOpt, ...rest } = options ?? {}
  const cacheKey = `issues:${JSON.stringify(rest)}`
  const ttl = ttlOpt ?? CACHE_TTL.tasks

  if (!noCache) {
    const cached = getCached<GitHubIssue[]>(cacheKey)
    if (cached) return cached
  }

  const stale = noCache ? null : getStale<GitHubIssue[]>(cacheKey)
  const octokit = getOctokit()

  let response
  try {
    response = await octokit.issues.listForRepo({
      owner: getOwner(),
      repo: getRepo(),
      state: options?.state || 'open',
      labels: options?.labels,
      milestone: options?.milestone ? String(options.milestone) : undefined,
      per_page: options?.perPage || 50,
      sort: 'updated',
      direction: 'desc',
      since: options?.since as any, // Octokit accepts ISO string
      headers: stale?.etag ? { 'If-None-Match': stale.etag } : undefined,
    })
  } catch (err: any) {
    // 304 Not Modified — reuse stale data, refresh TTL, no rate cost
    if (err.status === 304 && stale) {
      setCache(cacheKey, ttl, stale.data, { etag: stale.etag })
      return stale.data
    }
    throw err
  }

  const data = response.data
  const newEtag = (response.headers as Record<string, string | undefined>)?.etag

  const excludeSet = new Set((options?.excludeLabels ?? []).map((l) => l.toLowerCase()))

  // Filter out pull requests — GitHub issues API returns both issues and PRs
  // Also drop issues that carry any of the excluded labels (post-fetch because
  // the REST API's `labels` param only supports intersection, not negation).
  const issues: GitHubIssue[] = data
    .filter((issue: any) => !issue.pull_request)
    .filter((issue: any) => {
      if (excludeSet.size === 0) return true
      const names: string[] = (issue.labels ?? []).map((l: any) =>
        (typeof l === 'string' ? l : (l.name ?? '')).toLowerCase(),
      )
      return !names.some((n) => excludeSet.has(n))
    })
    .map((issue: any) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state as 'open' | 'closed',
      labels: issue.labels.map((l: any) =>
        typeof l === 'string'
          ? { name: l, color: '000000' }
          : { name: l.name ?? '', color: l.color ?? '000000' },
      ),
      milestone: issue.milestone ? { title: issue.milestone.title ?? '' } : null,
      assignees:
        issue.assignees?.map((a: any) => ({
          login: a.login ?? '',
          avatar_url: a.avatar_url ?? '',
        })) ?? [],
      created_at: issue.created_at ?? '',
      updated_at: issue.updated_at ?? '',
      closed_at: issue.closed_at ?? null,
      html_url: issue.html_url ?? '',
      isKodyAssigned:
        issue.assignees?.some(
          (a: any) =>
            a.login === 'github-actions[bot]' || a.login === 'Copilot' || a.type === 'Bot',
        ) ?? false,
    }))

  if (!noCache) {
    setCache(cacheKey, ttl, issues, { etag: newEtag })
  }
  return issues
}

/**
 * Fetch comments for an issue
 */
export async function fetchComments(issueNumber: number): Promise<GitHubComment[]> {
  const cacheKey = `comments:${issueNumber}`
  const cached = getCached<GitHubComment[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  const { data } = await octokit.issues.listComments({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    per_page: 100,
  })

  const comments: GitHubComment[] = data.map((comment: any) => ({
    id: comment.id,
    body: comment.body ?? '',
    created_at: comment.created_at ?? '',
    user: {
      login: comment.user?.login ?? 'unknown',
      type: comment.user?.type ?? 'User',
      avatar_url: comment.user?.avatar_url ?? '',
    },
  }))

  // Comments are less likely to change, cache longer
  setCache(cacheKey, CACHE_TTL.tasks * 2, comments)
  return comments
}

// ============ Workflow Runs ============

/**
 * Fetch workflow runs for the Kody workflow
 */
export async function fetchWorkflowRuns(options?: {
  status?: 'queued' | 'in_progress' | 'completed'
  perPage?: number
}): Promise<WorkflowRun[]> {
  const cacheKey = `workflows:${JSON.stringify(options)}`
  const cached = getCached<WorkflowRun[]>(cacheKey)
  if (cached) return cached

  const stale = getStale<WorkflowRun[]>(cacheKey)
  const octokit = getOctokit()

  let response
  try {
    response = await octokit.actions.listWorkflowRuns({
      owner: getOwner(),
      repo: getRepo(),
      workflow_id: WORKFLOW_ID,
      status: options?.status,
      per_page: options?.perPage || 20,
      headers: stale?.etag ? { 'If-None-Match': stale.etag } : undefined,
    })
  } catch (err: any) {
    if (err.status === 304 && stale) {
      setCache(cacheKey, CACHE_TTL.pipeline, stale.data, { etag: stale.etag })
      return stale.data
    }
    throw err
  }

  const data = response.data
  const newEtag = (response.headers as Record<string, string | undefined>)?.etag

  const runs: WorkflowRun[] = data.workflow_runs.map((run) => ({
    id: run.id,
    status: run.status as 'queued' | 'in_progress' | 'completed',
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
    display_title: (run as any).display_title ?? '',
    head_branch: (run as any).head_branch ?? undefined,
  }))

  setCache(cacheKey, CACHE_TTL.pipeline, runs, { etag: newEtag })
  return runs
}

/**
 * Get workflow run for a specific task
 */
export async function getWorkflowRunForTask(taskId: string): Promise<WorkflowRun | null> {
  const runs = await fetchWorkflowRuns({ perPage: 50 })
  // Look for run with the task ID in the head_branch or workflow run name
  return (
    runs.find((run) => run.html_url.includes(taskId) || taskId.includes(run.id.toString())) || null
  )
}

/**
 * Fetch check runs (lint, test, typecheck, etc.) for a workflow run
 */
export async function fetchCheckRunsForRun(runId: number): Promise<CheckRunResult[]> {
  const cacheKey = `check-runs:${runId}`
  const cached = getCached<CheckRunResult[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    // Get jobs for the workflow run - these contain lint, test, typecheck results
    const { data } = await octokit.actions.listJobsForWorkflowRun({
      owner: getOwner(),
      repo: getRepo(),
      run_id: runId,
      per_page: 50,
    })

    const checkRuns: CheckRunResult[] = (data.jobs as any[]).map((job) => ({
      name: job.name,
      status: job.status as 'queued' | 'in_progress' | 'completed',
      conclusion: job.conclusion as CheckRunResult['conclusion'],
      output: job.steps
        ? {
            summary: `${job.steps.length} steps`,
            text: JSON.stringify(
              job.steps.map((s: any) => ({
                name: s.name,
                status: s.status,
                conclusion: s.conclusion,
              })),
            ),
          }
        : undefined,
      html_url: job.html_url || undefined,
    }))

    setCache(cacheKey, CACHE_TTL.pipeline, checkRuns)
    return checkRuns
  } catch (error) {
    console.error('[Kody] Error fetching check runs:', error)
    return []
  }
}

// ============ Bulk PR Fetch ============

interface OpenPRsGraphQL {
  repository: {
    pullRequests: {
      nodes: Array<{
        databaseId: number
        number: number
        title: string
        state: 'OPEN' | 'CLOSED' | 'MERGED'
        url: string
        mergedAt: string | null
        headRefName: string
        headRefOid: string
        labels: { nodes: Array<{ name: string }> }
        closingIssuesReferences: { nodes: Array<{ number: number }> }
      }>
    }
  }
}

/**
 * Fetch all open PRs in one GraphQL call. Returns each PR with the issue
 * numbers it links via "Closes/Fixes/Resolves #N" so the dashboard can match
 * PRs to tasks without parsing branch names.
 *
 * GraphQL doesn't expose ETag/304 the way REST does, so the rate-limit budget
 * relies on:
 * - The `CACHE_TTL.prs` cache (5min) keeping fresh polls off the wire.
 * - In-flight dedup (concurrent callers in the same instance share one query).
 * - A stale fallback: if GitHub throttles or errors, return the previous list
 *   instead of bubbling the failure (and instead of retrying immediately).
 */
const inflightOpenPRs = new Map<string, Promise<GitHubPR[]>>()

export async function fetchOpenPRs(): Promise<GitHubPR[]> {
  const cacheKey = `open-prs:${getOwner()}:${getRepo()}`
  const cached = getCached<GitHubPR[]>(cacheKey)
  if (cached) return cached

  const existing = inflightOpenPRs.get(cacheKey)
  if (existing) return existing

  const stale = getStale<GitHubPR[]>(cacheKey)
  const octokit = getOctokit()

  const query = `
    query OpenPRs($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            databaseId
            number
            title
            state
            url
            mergedAt
            headRefName
            headRefOid
            labels(first: 20) { nodes { name } }
            closingIssuesReferences(first: 10) { nodes { number } }
          }
        }
      }
    }
  `

  const promise = (async () => {
    try {
      const data = await octokit.graphql<OpenPRsGraphQL>(query, {
        owner: getOwner(),
        repo: getRepo(),
      })

      const prs: GitHubPR[] = data.repository.pullRequests.nodes.map((pr) => ({
        id: pr.databaseId,
        number: pr.number,
        title: pr.title,
        state: pr.state.toLowerCase(),
        head: { ref: pr.headRefName, sha: pr.headRefOid },
        merged_at: pr.mergedAt,
        html_url: pr.url,
        labels: pr.labels.nodes.map((l) => l.name).filter(Boolean),
        closingIssueNumbers: pr.closingIssuesReferences.nodes.map((n) => n.number),
      }))

      setCache(cacheKey, CACHE_TTL.prs, prs)
      return prs
    } catch (err) {
      if (stale) {
        // Refresh the TTL on stale data so we don't hammer GraphQL on every
        // subsequent poll while we're being throttled.
        setCache(cacheKey, Math.min(CACHE_TTL.prs, 60_000), stale.data)
        return stale.data
      }
      throw err
    } finally {
      inflightOpenPRs.delete(cacheKey)
    }
  })()

  inflightOpenPRs.set(cacheKey, promise)
  return promise
}

// ============ Vercel Preview URLs ============

/**
 * Fetch Vercel preview URLs for a set of PR head SHAs.
 * Strategy: 1 bulk call for the 100 most recent Preview deployments (GitHub's
 * max page size), then 1 status call per matched deployment.
 *
 * Older SHAs that fall outside the 100-deployment window simply don't get a
 * preview URL — accepted tradeoff to avoid the previous per-SHA fanout, which
 * cost 2 extra REST calls per missed PR on every tasks-list poll.
 */
export async function fetchDeploymentPreviews(prShas: string[]): Promise<Map<string, string>> {
  if (prShas.length === 0) return new Map()

  const cacheKey = `previews:${getOwner()}:${getRepo()}:${prShas.sort().join(',')}`
  const cached = getCached<Map<string, string>>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()
  const result = new Map<string, string>()

  try {
    const { data: deployments } = await octokit.repos.listDeployments({
      owner: getOwner(),
      repo: getRepo(),
      environment: 'Preview',
      per_page: 100,
    })

    const shaSet = new Set(prShas)
    const matched = deployments.filter((d) => shaSet.has(d.sha))

    await Promise.all(
      matched.map(async (deployment) => {
        try {
          const { data: statuses } = await octokit.repos.listDeploymentStatuses({
            owner: getOwner(),
            repo: getRepo(),
            deployment_id: deployment.id,
            per_page: 1,
          })
          if (statuses.length > 0 && statuses[0].environment_url) {
            result.set(deployment.sha, statuses[0].environment_url)
          }
        } catch {
          // Skip individual failures
        }
      }),
    )
  } catch (error) {
    console.error('[Kody] Error fetching deployment previews:', error)
  }

  setCache(cacheKey, CACHE_TTL.prs, result)
  return result
}

// ============ PR Discovery ============

/**
 * Find PR associated with a task by branch name
 */
export async function findAssociatedPR(taskId: string): Promise<GitHubPR | null> {
  const cacheKey = `pr:${taskId}`
  const cached = getCached<GitHubPR | null>(cacheKey)
  if (cached !== null) return cached

  const octokit = getOctokit()

  // Try all branch prefixes
  const branchNames = BRANCH_PREFIXES.map((prefix) => `${prefix}/${taskId}`)

  for (const branchName of branchNames) {
    try {
      const { data } = await octokit.pulls.list({
        owner: getOwner(),
        repo: getRepo(),
        head: `${getOwner()}:${branchName}`,
        state: 'open',
      })

      if (data.length > 0) {
        const pr: GitHubPR = {
          id: data[0].id,
          number: data[0].number,
          title: data[0].title,
          state: data[0].state,
          head: {
            ref: data[0].head.ref,
            sha: data[0].head.sha,
          },
          merged_at: data[0].merged_at,
          html_url: data[0].html_url,
        }
        setCache(cacheKey, CACHE_TTL.prs, pr)
        return pr
      }
    } catch {
      // Try next prefix
    }
  }

  // Cache null as well
  setCache(cacheKey, CACHE_TTL.prs, null)
  return null
}

/**
 * Find the PR associated with a GitHub issue number.
 * Uses the bulk open-PR list (cached) + branch name pattern matching.
 * This is the preferred method — findAssociatedPR(taskId) only works
 * for branches named exactly {prefix}/{taskId}, which fails for
 * Kody-generated branches like fix/260312-auto-781-title.
 */
export async function findAssociatedPRByIssueNumber(issueNumber: number): Promise<GitHubPR | null> {
  const cacheKey = `pr:issue:${getOwner()}:${getRepo()}:${issueNumber}`
  const cached = getCached<GitHubPR | null>(cacheKey)
  if (cached !== null) return cached

  // 1. Check open PRs (fast, uses cached bulk list)
  const openPRs = await fetchOpenPRs()
  const issueStr = String(issueNumber)

  for (const pr of openPRs) {
    // Kody-auto branches put the issue number after "-auto-", so check that
    // before the generic first-digits pattern (which would capture YYMMDD).
    const autoMatch = pr.head.ref.match(/-auto-(\d+)-/)
    if (autoMatch && autoMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr)
      return pr
    }
    // Traditional: {prefix}/{issueNumber}-{title}
    const branchMatch = pr.head.ref.match(/\/(\d{3,})-/)
    if (!autoMatch && branchMatch && branchMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr)
      return pr
    }
    // Match by PR title "Closes #NNN"
    const closesMatch = pr.title.match(/(?:closes|fixes|resolves)\s+#(\d+)/i)
    if (closesMatch && closesMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr)
      return pr
    }
  }

  // 2. Fallback: find branch by issue number and look up PR by head ref
  const branch = await findBranchByIssueNumber(issueNumber)
  if (branch) {
    const octokit = getOctokit()
    try {
      const { data } = await octokit.pulls.list({
        owner: getOwner(),
        repo: getRepo(),
        head: `${getOwner()}:${branch}`,
        state: 'open',
      })
      if (data.length > 0) {
        const pr: GitHubPR = {
          id: data[0].id,
          number: data[0].number,
          title: data[0].title,
          state: data[0].state,
          head: { ref: data[0].head.ref, sha: data[0].head.sha },
          merged_at: data[0].merged_at,
          html_url: data[0].html_url,
        }
        setCache(cacheKey, CACHE_TTL.prs, pr)
        return pr
      }
    } catch {
      // Fall through
    }
  }

  setCache(cacheKey, CACHE_TTL.prs, null)
  return null
}

/**
 * Fetch comments for a PR
 */
export async function fetchPRComments(prNumber: number): Promise<PRComment[]> {
  const cacheKey = `pr-comments:${prNumber}`
  const cached = getCached<PRComment[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    const { data } = await octokit.issues.listComments({
      owner: getOwner(),
      repo: getRepo(),
      issue_number: prNumber,
      per_page: 50,
    })

    const comments: PRComment[] = data.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      created_at: comment.created_at,
      user: {
        login: comment.user?.login || '',
        avatar_url: comment.user?.avatar_url || '',
      },
    }))

    setCache(cacheKey, CACHE_TTL.tasks, comments)
    return comments
  } catch (error) {
    console.error('[Kody] Error fetching PR comments:', error)
    return []
  }
}

/**
 * Fetch file changes for a PR
 */
export async function fetchPRFileChanges(prNumber: number): Promise<FileChange[]> {
  const cacheKey = `pr-files:${prNumber}`
  const cached = getCached<FileChange[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    const { data } = await octokit.pulls.listFiles({
      owner: getOwner(),
      repo: getRepo(),
      pull_number: prNumber,
      per_page: 100,
    })

    const changes: FileChange[] = data.map((file) => ({
      filename: file.filename,
      status: file.status as FileChange['status'],
      additions: file.additions,
      deletions: file.deletions,
    }))

    setCache(cacheKey, CACHE_TTL.tasks, changes)
    return changes
  } catch (error) {
    console.error('[Kody] Error fetching PR files:', error)
    return []
  }
}

/**
 * Close a PR (without merging)
 */
export async function closePR(prNumber: number, userOctokit?: Octokit): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.pulls.update({
    owner: getOwner(),
    repo: getRepo(),
    pull_number: prNumber,
    state: 'closed',
  })

  // Invalidate PR cache only
  invalidatePRCache()
}

/**
 * Delete a branch
 */
export async function deleteBranch(branchName: string, userOctokit?: Octokit): Promise<void> {
  // Don't delete protected branches
  if (branchName === 'dev' || branchName === 'main' || branchName === 'master') {
    console.log(`[Kody] Skipping deletion of protected branch: ${branchName}`)
    return
  }

  const octokit = userOctokit ?? getOctokit()

  try {
    await octokit.git.deleteRef({
      owner: getOwner(),
      repo: getRepo(),
      ref: `heads/${branchName}`,
    })
    console.log(`[Kody] Deleted branch: ${branchName}`)
  } catch (error: any) {
    // Ignore if branch doesn't exist
    if (error.status === 422 && error.message?.includes('Reference does not exist')) {
      console.log(`[Kody] Branch already deleted: ${branchName}`)
      return
    }
    throw error
  }

  // Invalidate branch and task caches
  invalidateBranchCache()
  invalidateTaskCache()
}

/**
 * Fetch all task documents from branch by listing the task directory.
 * Discovers files dynamically instead of using a hardcoded list.
 */
export async function fetchTaskDocuments(taskId: string, branch: string): Promise<TaskDocument[]> {
  const octokit = getOctokit()
  const taskPath = `.tasks/${taskId}`

  try {
    // List all files in the task directory
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: taskPath,
      ref: branch,
    })

    if (!Array.isArray(data)) return []

    // Filter to files only (skip subdirectories), fetch content in parallel
    const files = data.filter((item: any) => item.type === 'file')

    const results = await Promise.allSettled(
      files.map(async (file: any) => {
        try {
          const { data: fileData } = await octokit.repos.getContent({
            owner: getOwner(),
            repo: getRepo(),
            path: file.path,
            ref: branch,
          })

          if ('content' in fileData && fileData.content) {
            const content = Buffer.from(fileData.content, 'base64').toString('utf-8')
            return {
              name: file.name as string,
              content,
              path: file.path as string,
            }
          }
        } catch {
          // File content couldn't be fetched
        }
        return null
      }),
    )

    const documents: TaskDocument[] = []
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        documents.push(result.value)
      }
    }

    return documents
  } catch {
    // Task directory doesn't exist on this branch
    return []
  }
}

/**
 * Fetch task documents by discovering the task directory on a branch.
 * Lists .tasks/ dir, finds dirs matching YYMMDD- pattern, picks the newest,
 * then fetches known doc files from it.
 */
export async function fetchBranchDocuments(branch: string): Promise<TaskDocument[]> {
  const octokit = getOctokit()

  try {
    // 1. List .tasks/ directory on the branch
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: '.tasks',
      ref: branch,
    })

    if (!Array.isArray(data)) return []

    // 2. Find directories matching YYMMDD- pattern (e.g., 260228-auto-74)
    const taskDirs = data
      .filter((item: any) => item.type === 'dir' && /^\d{6}-/.test(item.name))
      .map((item: any) => item.name)
      .sort()
      .reverse() // newest first by date prefix

    if (taskDirs.length === 0) return []

    // 3. Use the newest task dir
    const taskId = taskDirs[0]

    // 4. Fetch known doc files from it
    return fetchTaskDocuments(taskId, branch)
  } catch (error: any) {
    if (error.status !== 404) {
      console.error('[Kody] Error listing branch task dirs:', error)
    }
    return []
  }
}

// ============ Labels & Milestones ============

/**
 * Fetch all labels
 */
export async function fetchLabels(): Promise<Array<{ name: string; color: string }>> {
  const cacheKey = 'labels'
  const cached = getCached<Array<{ name: string; color: string }>>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  const { data } = await octokit.issues.listLabelsForRepo({
    owner: getOwner(),
    repo: getRepo(),
    per_page: 100,
  })

  const labels = data.map((label) => ({
    name: label.name,
    color: label.color,
  }))

  setCache(cacheKey, CACHE_TTL.boards, labels)
  return labels
}

/**
 * Fetch all milestones
 */
export async function fetchMilestones(): Promise<
  Array<{ id: number; title: string; number: number }>
> {
  const cacheKey = 'milestones'
  const cached = getCached<Array<{ id: number; title: string; number: number }>>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  const { data } = await octokit.issues.listMilestones({
    owner: getOwner(),
    repo: getRepo(),
    state: 'open',
    per_page: 50,
  })

  const milestones = data.map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    number: milestone.number,
  }))

  setCache(cacheKey, CACHE_TTL.boards, milestones)
  return milestones
}

// ============ Actions ============

/**
 * Post a comment on an issue
 */
export async function postComment(
  issueNumber: number,
  body: string,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.issues.createComment({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    body,
  })

  // Invalidate comment cache
  cache.delete(`comments:${issueNumber}`)
}

/**
 * Trigger workflow dispatch
 */
export async function triggerWorkflow(
  options: {
    taskId: string
    mode?: string
    fromStage?: string
    feedback?: string
  },
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.actions.createWorkflowDispatch({
    owner: getOwner(),
    repo: getRepo(),
    workflow_id: WORKFLOW_ID,
    ref: 'main',
    inputs: {
      task_id: options.taskId,
      mode: options.mode || 'full',
      from_stage: options.fromStage || '',
      feedback: options.feedback || '',
    },
  })
}

/**
 * Cancel a workflow run
 */
export async function cancelWorkflowRun(runId: number, userOctokit?: Octokit): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.actions.cancelWorkflowRun({
    owner: getOwner(),
    repo: getRepo(),
    run_id: runId,
  })
}

// ============ Issue CRUD Operations ============

/**
 * Create a new GitHub issue
 */
export async function createIssue(
  options: {
    title: string
    body?: string
    labels?: string[]
    assignees?: string[]
  },
  userOctokit?: Octokit,
): Promise<GitHubIssue> {
  const octokit = userOctokit ?? getOctokit()

  const { data } = await octokit.issues.create({
    owner: getOwner(),
    repo: getRepo(),
    title: options.title,
    body: options.body ?? '',
    labels: options.labels,
    assignees: options.assignees,
  })

  // Invalidate task-related caches only (not PRs, boards, etc.)
  invalidateTaskCache()

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    state: data.state as 'open' | 'closed',
    labels:
      data.labels?.map((l: any) => ({
        name: l.name ?? '',
        color: l.color ?? '000000',
      })) ?? [],
    milestone: data.milestone ? { title: data.milestone.title ?? '' } : null,
    assignees:
      data.assignees?.map((a: any) => ({
        login: a.login ?? '',
        avatar_url: a.avatar_url ?? '',
      })) ?? [],
    created_at: data.created_at ?? '',
    updated_at: data.updated_at ?? '',
    closed_at: data.closed_at ?? null,
    html_url: data.html_url ?? '',
  }
}

/**
 * Upload an attachment to an issue (requires GitHub Enterprise)
 */
export async function uploadIssueAttachment(
  issueNumber: number,
  file: { name: string; content: string },
  userOctokit?: Octokit,
): Promise<{ attachment_url: string; name: string }> {
  const octokit = (userOctokit ?? getOctokit()) as any

  const buffer = Buffer.from(file.content, 'base64')

  const response = await octokit.request(
    'POST /repos/{owner}/{repo}/issues/{issue_number}/attachments',
    {
      owner: getOwner(),
      repo: getRepo(),
      issue_number: issueNumber,
      name: file.name,
      file: buffer,
    },
  )

  return {
    attachment_url: response.data.asset_url,
    name: response.data.name,
  }
}

/**
 * Update an issue (close, reopen, change title/body)
 */
export async function updateIssue(
  issueNumber: number,
  options: {
    title?: string
    body?: string
    state?: 'open' | 'closed'
    labels?: string[]
    assignees?: string[]
  },
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.issues.update({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    title: options.title,
    body: options.body,
    state: options.state,
    labels: options.labels,
    assignees: options.assignees,
  })

  // Invalidate task cache
  invalidateTaskCache()
  cache.delete(`comments:${issueNumber}`)
}

/**
 * Add assignees to an issue
 */
export async function addAssignees(
  issueNumber: number,
  assignees: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.issues.addAssignees({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    assignees,
  })

  // Invalidate task cache
  invalidateTaskCache()
}

/**
 * Remove assignees from an issue
 */
export async function removeAssignees(
  issueNumber: number,
  assignees: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.issues.removeAssignees({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    assignees,
  })

  // Invalidate task cache
  invalidateTaskCache()
}

/**
 * Add labels to an issue
 */
export async function addLabels(
  issueNumber: number,
  labels: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.issues.addLabels({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    labels,
  })

  // Invalidate task cache
  invalidateTaskCache()
}

/**
 * Create a repo label if it does not already exist. Idempotent — a 422 from
 * GitHub ("already_exists") is treated as success. GitHub's addLabels endpoint
 * does NOT auto-create labels, so callers that attach ad-hoc labels (e.g.
 * `goal:<id>`) should ensure the label first.
 */
export async function ensureLabel(
  name: string,
  options: { color?: string; description?: string } = {},
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit()
  try {
    await octokit.issues.createLabel({
      owner: getOwner(),
      repo: getRepo(),
      name,
      color: (options.color ?? 'cccccc').replace(/^#/, ''),
      description: options.description,
    })
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status !== 422) throw err
  }
}

/**
 * Remove a label from an issue
 */
export async function removeLabel(
  issueNumber: number,
  label: string,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit()

  await octokit.issues.removeLabel({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    name: label,
  })

  // Invalidate task cache
  invalidateTaskCache()
}

/**
 * Fetch repository collaborators (for assignee picker).
 * Returns [] if the token lacks permission to list collaborators (e.g., private repo
 * where user is not an explicit collaborator, or insufficient scopes).
 */
export async function fetchCollaborators(): Promise<GitHubCollaborator[]> {
  const cacheKey = `collaborators:${getOwner()}:${getRepo()}`
  const cached = getCached<GitHubCollaborator[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    const { data } = await octokit.repos.listCollaborators({
      owner: getOwner(),
      repo: getRepo(),
      per_page: 100,
    })

    const collaborators: GitHubCollaborator[] = data.map((user) => ({
      login: user.login ?? '',
      avatar_url: user.avatar_url ?? '',
    }))

    setCache(cacheKey, CACHE_TTL.boards, collaborators)
    return collaborators
  } catch (error: unknown) {
    // Permission denied (403) or not found (404) — user is not a collaborator or token lacks scope
    const status = (error as { status?: number })?.status
    if (status === 403 || status === 404) {
      console.warn(`[Kody] Cannot list collaborators (${status}), returning empty list`)
      return []
    }
    throw error
  }
}

// ============ Utility ============

/**
 * Clear all cache (for testing or manual refresh)
 */
export function clearCache(): void {
  cache.clear()
}

/**
 * Clear specific cache categories
 */
export function clearCacheByCategory(
  category: 'all' | 'tasks' | 'prs' | 'boards' | 'branches',
): void {
  switch (category) {
    case 'all':
      cache.clear()
      break
    case 'tasks':
      invalidateTaskCache()
      break
    case 'prs':
      invalidatePRCache()
      break
    case 'boards':
      invalidateBoardCache()
      break
    case 'branches':
      invalidateBranchCache()
      break
  }
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  }
}

// ============ PR CI Status ============

type CIStatus = 'pending' | 'success' | 'failure' | 'running'

interface PRCIStatusResult {
  ciStatus: CIStatus
  mergeable: boolean
  hasConflicts: boolean
}

interface PRCIStatusGraphQL {
  repository: {
    pullRequest: {
      mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
      mergeStateStatus:
        | 'CLEAN'
        | 'DIRTY'
        | 'BLOCKED'
        | 'BEHIND'
        | 'UNKNOWN'
        | 'UNSTABLE'
        | 'HAS_HOOKS'
      commits: {
        nodes: Array<{
          commit: {
            statusCheckRollup: {
              state: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED'
            } | null
          }
        }>
      }
    } | null
  } | null
}

function mapRollupState(state: string | null | undefined): CIStatus {
  if (!state) return 'success' // no checks configured — nothing to wait for
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
      return 'running'
    case 'EXPECTED':
    default:
      return 'pending'
  }
}

/**
 * Fetch mergeability + CI rollup for a PR in a single GraphQL call.
 *
 * GraphQL's `statusCheckRollup` aggregates both status contexts (Vercel etc.)
 * and check runs (GitHub Actions), already deduped to the latest run per name —
 * identical semantics to the previous REST 3-call combo (pulls.get +
 * getCombinedStatusForRef + checks.listForRef), at 1 GraphQL point budget.
 */
export async function fetchPRCIStatus(prNumber: number): Promise<PRCIStatusResult> {
  const cacheKey = `pr-ci-status:${prNumber}`
  const cached = getCached<PRCIStatusResult>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  const query = `
    query PRCIStatus($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          mergeable
          mergeStateStatus
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup { state }
              }
            }
          }
        }
      }
    }
  `

  try {
    const data = await octokit.graphql<PRCIStatusGraphQL>(query, {
      owner: getOwner(),
      repo: getRepo(),
      number: prNumber,
    })

    const pr = data.repository?.pullRequest
    if (!pr) {
      return { ciStatus: 'pending', mergeable: false, hasConflicts: false }
    }

    const rollupState = pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null
    const noConflicts = pr.mergeable === 'MERGEABLE'
    let ciStatus: CIStatus
    let hasConflicts = false

    switch (pr.mergeStateStatus) {
      case 'CLEAN':
      case 'UNSTABLE':
        // All required checks passed; 'UNSTABLE' = non-required check failed but mergeable.
        ciStatus = 'success'
        break
      case 'BLOCKED':
        // Steady state for repos without branch protection — fall back to rollup.
        ciStatus = noConflicts ? mapRollupState(rollupState) : 'running'
        break
      case 'BEHIND':
      case 'HAS_HOOKS':
        ciStatus = 'running'
        break
      case 'DIRTY':
        ciStatus = 'failure'
        hasConflicts = true
        break
      case 'UNKNOWN':
      default:
        ciStatus = 'pending'
    }

    const mergeable =
      noConflicts &&
      (ciStatus === 'success' ||
        pr.mergeStateStatus === 'CLEAN' ||
        pr.mergeStateStatus === 'UNSTABLE')

    const result: PRCIStatusResult = { ciStatus, mergeable, hasConflicts }
    setCache(cacheKey, 15_000, result)
    return result
  } catch (error) {
    console.error('[Kody] Error fetching PR CI status:', error)
    return { ciStatus: 'pending', mergeable: false, hasConflicts: false }
  }
}
