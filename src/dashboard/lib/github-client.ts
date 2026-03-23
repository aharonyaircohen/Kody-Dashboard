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
  cache.delete(key)
  return null
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
  invalidateCache('issues-')
  invalidateCache('workflow-')
}

export function invalidatePRCache(): void {
  invalidateCache('prs-')
  invalidateCache('pr-')
}

export function invalidateBoardCache(): void {
  invalidateCache('boards-')
  invalidateCache('labels-')
  invalidateCache('milestones-')
}

export function invalidateBranchCache(): void {
  invalidateCache('branches-')
  invalidateCache('refs-')
}

// ============ Octokit Singleton ============

let octokitInstance: Octokit | null = null

type ThrottledOctokit = Octokit & ReturnType<typeof throttling>

export function getOctokit(): Octokit {
  if (octokitInstance) return octokitInstance as ThrottledOctokit

  // Prefer KODY_BOT_TOKEN if set (for bot attribution), otherwise fall back to GITHUB_TOKEN
  const token = process.env.KODY_BOT_TOKEN || process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('Neither KODY_BOT_TOKEN nor GITHUB_TOKEN is configured')
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
 * Find the branch for a task by trying all possible prefixes
 */
export async function findTaskBranch(taskId: string): Promise<string | null> {
  if (!TASK_ID_REGEX.test(taskId)) {
    return null
  }

  const octokit = getOctokit()

  // Try all prefixes in parallel
  const results = await Promise.allSettled(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branchName = `${prefix}/${taskId}`
      try {
        await octokit.repos.getBranch({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          branch: branchName,
        })
        return branchName
      } catch {
        return null
      }
    }),
  )

  // Return first successful result
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value
    }
  }

  return null
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

  const octokit = getOctokit()
  const issueStr = String(issueNumber)

  // Search each prefix in parallel using the matching-refs API
  const results = await Promise.allSettled(
    BRANCH_PREFIXES.map(async (prefix) => {
      try {
        const { data } = await octokit.git.listMatchingRefs({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          ref: `heads/${prefix}/`,
        })

        // Find branches containing -<issueNumber>- in their name
        // e.g., fix/260228-auto-635-fix-conversation-delete-endpoint-b
        const pattern = new RegExp(`-${issueStr}-`)
        const match = data.find((ref: any) => {
          const branchName = ref.ref.replace('refs/heads/', '')
          return pattern.test(branchName)
        })

        return match ? match.ref.replace('refs/heads/', '') : null
      } catch {
        return null
      }
    }),
  )

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      setCache(cacheKey, BRANCH_CACHE_TTL, result.value)
      return result.value
    }
  }

  return null
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
  const octokit = getOctokit()

  // Fetch all branches for each prefix in parallel
  // Map updates + caching happen in-place, results not needed
  void (await Promise.allSettled(
    BRANCH_PREFIXES.map(async (prefix) => {
      // Check cache first for this prefix's branch list
      const prefixCacheKey = `branches:prefix:${prefix}`
      let branches: string[] | null = getCached<string[]>(prefixCacheKey)

      if (!branches) {
        // Not cached, fetch from GitHub
        try {
          const { data } = await octokit.git.listMatchingRefs({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            ref: `heads/${prefix}/`,
          })
          branches = data.map((ref: any) => ref.ref.replace('refs/heads/', ''))
          // Cache the full branch list for this prefix (10 min)
          setCache(prefixCacheKey, BRANCH_CACHE_TTL, branches)
        } catch {
          branches = []
        }
      }

      // Now search for each issue number in this prefix's branches
      for (const issueStr of issueStrs) {
        const pattern = new RegExp(`-${issueStr}-`)
        const match = branches!.find((branchName) => pattern.test(branchName))
        if (match) {
          const issueNum = parseInt(issueStr, 10)
          // Only set if not already found (first match wins)
          if (!result.has(issueNum)) {
            result.set(issueNum, match)
            // Also cache individual branch lookup for future single-issue lookups
            const individualCacheKey = `branch:issue:${issueStr}`
            setCache(individualCacheKey, BRANCH_CACHE_TTL, match)
          }
        }
      }

      return branches
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
 * Fetch a single issue by number (optimized for detail view)
 */
export async function fetchIssue(issueNumber: number): Promise<GitHubIssue | null> {
  const cacheKey = `issue:${issueNumber}`
  const cached = getCached<GitHubIssue>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    const { data } = await octokit.issues.get({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      issue_number: issueNumber,
    })

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

    // Single issue, cache for longer
    setCache(cacheKey, CACHE_TTL.tasks, issue)
    return issue
  } catch (error: any) {
    if (error.status === 404) {
      return null
    }
    throw error
  }
}

/**
 * Fetch issues with optional filters
 */
export async function fetchIssues(options?: {
  state?: 'open' | 'closed' | 'all'
  labels?: string
  milestone?: number
  perPage?: number
  since?: string // ISO 8601 date string - only returns issues updated after this date
}): Promise<GitHubIssue[]> {
  const cacheKey = `issues:${JSON.stringify(options)}`
  const cached = getCached<GitHubIssue[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  const { data } = await octokit.issues.listForRepo({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    state: options?.state || 'open',
    labels: options?.labels,
    milestone: options?.milestone ? String(options.milestone) : undefined,
    per_page: options?.perPage || 50,
    sort: 'updated',
    direction: 'desc',
    since: options?.since as any, // Octokit accepts ISO string
  })

  // Filter out pull requests — GitHub issues API returns both issues and PRs
  const issues: GitHubIssue[] = data
    .filter((issue: any) => !issue.pull_request)
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

  setCache(cacheKey, CACHE_TTL.tasks, issues)
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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

  const octokit = getOctokit()

  const { data } = await octokit.actions.listWorkflowRuns({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    workflow_id: WORKFLOW_ID,
    status: options?.status,
    per_page: options?.perPage || 20,
  })

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

  setCache(cacheKey, CACHE_TTL.pipeline, runs)
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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

/**
 * Fetch all open PRs in one call (cheap: single API request).
 * Used by the dashboard to match PRs to issues without N per-issue calls.
 */
export async function fetchOpenPRs(): Promise<GitHubPR[]> {
  const cacheKey = 'open-prs'
  const cached = getCached<GitHubPR[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  const { data } = await octokit.pulls.list({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    state: 'open',
    per_page: 50,
    sort: 'updated',
    direction: 'desc',
  })

  const prs: GitHubPR[] = data.map((pr) => ({
    id: pr.id,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    head: {
      ref: pr.head.ref,
      sha: pr.head.sha,
    },
    merged_at: pr.merged_at,
    html_url: pr.html_url,
    labels: pr.labels?.map((l) => l.name ?? '').filter(Boolean) ?? [],
  }))

  setCache(cacheKey, CACHE_TTL.prs, prs)
  return prs
}

// ============ Vercel Preview URLs ============

/**
 * Fetch Vercel preview URLs for a set of PR head SHAs.
 * Strategy: 1 bulk call for recent deployments, then 1 status call per matched deployment.
 * For SHAs not found in the bulk fetch (older deployments beyond the 30-item window),
 * falls back to individual SHA-based lookups.
 * Returns a Map of SHA -> preview URL.
 */
export async function fetchDeploymentPreviews(prShas: string[]): Promise<Map<string, string>> {
  if (prShas.length === 0) return new Map()

  const cacheKey = `previews:${prShas.sort().join(',')}`
  const cached = getCached<Map<string, string>>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()
  const result = new Map<string, string>()

  try {
    // 1. Bulk fetch recent Preview deployments (1 API call)
    const { data: deployments } = await octokit.repos.listDeployments({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      environment: 'Preview',
      per_page: 30,
    })

    // 2. Match deployments to our PR SHAs
    const shaSet = new Set(prShas)
    const matched = deployments.filter((d) => shaSet.has(d.sha))

    // 3. Fetch status for each matched deployment (1 call per match, typically 1-3)
    await Promise.all(
      matched.map(async (deployment) => {
        try {
          const { data: statuses } = await octokit.repos.listDeploymentStatuses({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
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

    // 4. For SHAs not found in bulk fetch (older deployments), look up individually.
    // The bulk fetch only returns the most recent 30 deployments, so older PRs
    // won't be found. The individual lookup uses the ?sha= query parameter.
    const missedShas = prShas.filter((sha) => !result.has(sha))
    if (missedShas.length > 0) {
      await Promise.all(
        missedShas.map(async (sha) => {
          try {
            const { data: shaDeployments } = await octokit.repos.listDeployments({
              owner: GITHUB_OWNER,
              repo: GITHUB_REPO,
              sha,
              environment: 'Preview',
              per_page: 1,
            })
            if (shaDeployments.length > 0) {
              const { data: statuses } = await octokit.repos.listDeploymentStatuses({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                deployment_id: shaDeployments[0].id,
                per_page: 1,
              })
              if (statuses.length > 0 && statuses[0].environment_url) {
                result.set(sha, statuses[0].environment_url)
              }
            }
          } catch {
            // Skip individual failures
          }
        }),
      )
    }
  } catch (error) {
    console.error('[Kody] Error fetching deployment previews:', error)
  }

  // Cache for 2 minutes (deployments don't change often)
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
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        head: `${GITHUB_OWNER}:${branchName}`,
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
  const cacheKey = `pr:issue:${issueNumber}`
  const cached = getCached<GitHubPR | null>(cacheKey)
  if (cached !== null) return cached

  // 1. Check open PRs (fast, uses cached bulk list)
  const openPRs = await fetchOpenPRs()
  const issueStr = String(issueNumber)

  for (const pr of openPRs) {
    // Match by branch name pattern: {prefix}/{YYMMDD}-auto-{issueNumber}-{title}
    // or {prefix}/{issueNumber}-{title}
    const branchMatch = pr.head.ref.match(/\/(\d{3,})-/)
    if (branchMatch && branchMatch[1] === issueStr) {
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
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        head: `${GITHUB_OWNER}:${branch}`,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    issue_number: issueNumber,
    labels,
  })

  // Invalidate task cache
  invalidateTaskCache()
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
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    issue_number: issueNumber,
    name: label,
  })

  // Invalidate task cache
  invalidateTaskCache()
}

/**
 * Fetch repository collaborators (for assignee picker)
 */
export async function fetchCollaborators(): Promise<GitHubCollaborator[]> {
  const cacheKey = 'collaborators'
  const cached = getCached<GitHubCollaborator[]>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  const { data } = await octokit.repos.listCollaborators({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    per_page: 100,
  })

  const collaborators: GitHubCollaborator[] = data.map((user) => ({
    login: user.login ?? '',
    avatar_url: user.avatar_url ?? '',
  }))

  setCache(cacheKey, CACHE_TTL.boards, collaborators)
  return collaborators
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

/**
 * Fetch the combined CI status for a PR's head commit.
 * Uses the combined status API + check runs to determine overall state.
 */
export async function fetchPRCIStatus(prNumber: number): Promise<{
  ciStatus: 'pending' | 'success' | 'failure' | 'running'
  mergeable: boolean
  hasConflicts: boolean
}> {
  const cacheKey = `pr-ci-status:${prNumber}`
  const cached = getCached<{
    ciStatus: 'pending' | 'success' | 'failure' | 'running'
    mergeable: boolean
    hasConflicts: boolean
  }>(cacheKey)
  if (cached) return cached

  const octokit = getOctokit()

  try {
    // 1. Get the PR — GitHub computes mergeable state for us
    const { data: pr } = await octokit.pulls.get({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      pull_number: prNumber,
    })

    // 2. Map GitHub's mergeable_state to our CI status.
    //    GitHub's mergeable_state accounts for ALL required checks + branch protection + conflicts.
    //    See: https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
    //    Values: "clean" | "dirty" | "unstable" | "blocked" | "behind" | "unknown"
    const ghState = pr.mergeable_state
    let ciStatus: 'pending' | 'success' | 'failure' | 'running'
    let hasConflicts = false

    switch (ghState) {
      case 'clean':
        // All checks passed, no conflicts, meets branch protection — ready to merge
        ciStatus = 'success'
        break
      case 'unstable':
        // Some non-required checks failed, but required ones passed — still mergeable
        ciStatus = 'success'
        break
      case 'blocked':
        // GitHub returns 'blocked' when branch protection has required checks that haven't
        // completed, OR when there's NO branch protection at all (can't evaluate as 'clean').
        // Since this repo has no branch protection, 'blocked' is the steady state for all PRs.
        // Fall back to checking actual commit status to determine CI state.
        if (pr.mergeable === true) {
          ciStatus = await resolveCommitCIStatus(octokit, pr.head.sha)
        } else {
          ciStatus = 'running'
        }
        break
      case 'behind':
        // Branch is behind base — needs update but may be mergeable
        ciStatus = 'running'
        break
      case 'dirty':
        // Merge conflicts exist — distinct from CI failure
        ciStatus = 'failure'
        hasConflicts = true
        break
      case 'unknown':
        // GitHub is computing — retry soon
        ciStatus = 'pending'
        break
      default:
        ciStatus = 'pending'
    }

    // 3. Mergeable = GitHub says no conflicts AND CI is in a good state
    const mergeable =
      pr.mergeable === true &&
      (ciStatus === 'success' || ghState === 'clean' || ghState === 'unstable')

    const result = { ciStatus, mergeable, hasConflicts }

    // Short cache — 15s to stay responsive while CI runs
    setCache(cacheKey, 15_000, result)
    return result
  } catch (error) {
    console.error('[Kody] Error fetching PR CI status:', error)
    return { ciStatus: 'pending', mergeable: false, hasConflicts: false }
  }
}

/**
 * Check the combined commit status and check runs for a given SHA.
 * Used as fallback when mergeable_state is 'blocked' (no branch protection configured).
 *
 * Strategy:
 * - Combined status API (status checks like Vercel) is used as-is (already aggregated by GitHub)
 * - Check runs (GitHub Actions) are deduplicated by name, keeping only the latest run per check
 *   to avoid stale/superseded failures from blocking merge
 * - If combined status is 'success', individual check run failures are treated as non-essential
 *   (mirrors GitHub's own 'unstable' state behavior)
 */
async function resolveCommitCIStatus(
  octokit: Octokit,
  sha: string,
): Promise<'pending' | 'success' | 'failure' | 'running'> {
  try {
    // Get combined status (covers status API integrations like Vercel)
    const { data: combinedStatus } = await octokit.repos.getCombinedStatusForRef({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ref: sha,
    })

    // Get check runs (covers GitHub Actions checks)
    const { data: checkRuns } = await octokit.checks.listForRef({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ref: sha,
      per_page: 100,
    })

    const hasChecks = combinedStatus.statuses.length > 0 || checkRuns.check_runs.length > 0
    if (!hasChecks) {
      // No CI checks at all — consider it ready (nothing to wait for)
      return 'success'
    }

    // Deduplicate check runs by name, keeping only the latest run per check.
    // This prevents stale/superseded failures from blocking merge when a re-run passed.
    const latestCheckRuns = deduplicateCheckRuns(checkRuns.check_runs)

    // If the combined status API reports success, trust it as the primary signal.
    // Individual check run failures are treated as non-essential (mirrors 'unstable' behavior).
    if (combinedStatus.state === 'success' && combinedStatus.statuses.length > 0) {
      // Still check if any latest check runs are pending/running
      const anyRunning = latestCheckRuns.some(
        (cr) => cr.status === 'queued' || cr.status === 'in_progress',
      )
      return anyRunning ? 'running' : 'success'
    }

    // Check for failures in latest check runs only
    const statusFailed = combinedStatus.state === 'failure'
    const checkRunFailed = latestCheckRuns.some(
      (cr) => cr.conclusion === 'failure' || cr.conclusion === 'timed_out',
    )

    if (statusFailed || checkRunFailed) {
      return 'failure'
    }

    // Check if any are still running/pending
    const statusPending = combinedStatus.state === 'pending'
    const checkRunPending = latestCheckRuns.some(
      (cr) => cr.status === 'queued' || cr.status === 'in_progress',
    )

    if (statusPending || checkRunPending) {
      return 'running'
    }

    // All passed
    return 'success'
  } catch (error) {
    console.error('[Kody] Error resolving commit CI status:', error)
    return 'pending'
  }
}

/**
 * Deduplicate check runs by name, keeping only the latest run per unique check name.
 * GitHub can return multiple runs for the same check (e.g., after a re-run), and
 * stale failures should not block merge when the latest run succeeded.
 */
function deduplicateCheckRuns<
  T extends { name: string; started_at?: string | null; completed_at?: string | null },
>(checkRuns: T[]): T[] {
  const latestByName = new Map<string, T>()
  for (const cr of checkRuns) {
    const existing = latestByName.get(cr.name)
    if (!existing) {
      latestByName.set(cr.name, cr)
    } else {
      // Keep the one with the later started_at timestamp
      const existingTime = existing.started_at ? new Date(existing.started_at).getTime() : 0
      const crTime = cr.started_at ? new Date(cr.started_at).getTime() : 0
      if (crTime > existingTime) {
        latestByName.set(cr.name, cr)
      }
    }
  }
  return Array.from(latestByName.values())
}
