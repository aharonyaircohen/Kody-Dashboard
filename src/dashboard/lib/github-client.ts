/**
 * @fileType utility
 * @domain kody
 * @pattern github-client
 * @ai-summary GitHub API client with caching and manual rate limit handling
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AsyncLocalStorage } from "node:async_hooks";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  WORKFLOW_ID,
  BRANCH_PREFIXES,
  CACHE_TTL,
  BRANCH_CACHE_TTL,
  TASK_ID_REGEX,
  ALL_STAGES,
} from "./constants";
import {
  assertBudget,
  methodKind,
  recordResponseHeaders,
} from "./github-budget";
import { isProtectedBranch } from "./branches";
import { STATE_BRANCH } from "./state-branch";
import {
  parseActivityJsonl,
  sortActivityNewestFirst,
  type CompanyActivityRecord,
} from "./activity/company";
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
} from "./types";

// ============ Types ============

interface CacheEntry<T> {
  data: T;
  expires: number;
  etag?: string; // ETag from GitHub for conditional requests
  lastModified?: string; // Last-Modified header
}

// ============ Cache ============

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.data as T;
  }
  // Keep expired entries so their ETag survives for conditional GETs.
  // The next setCache (or invalidateCache) will overwrite / evict them.
  return null;
}

/**
 * Return a stale (expired) cache entry + its ETag, for use with
 * `If-None-Match` conditional GitHub requests. Returning 304 (free — does
 * not count against the rate limit) lets us refresh the TTL on the existing
 * data without re-downloading it.
 */
function getStale<T>(key: string): { data: T; etag?: string } | null {
  const entry = cache.get(key);
  return entry ? { data: entry.data as T, etag: entry.etag } : null;
}

/**
 * Get cached data along with its ETag for conditional requests
 */
export function setCache<T>(
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
  });
}

/**
 * Invalidate specific cache keys by prefix
 * More targeted than clearing the entire cache
 */
function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Cross-instance invalidation via Next's Data Cache. Local instance already
 * cleared its in-process Map above; this fans the same signal out to every
 * other serverless instance so they don't keep serving stale data until TTL.
 *
 * Safe today: unknown tags are no-ops in Next. As reads migrate to
 * `fetch(..., { next: { tags: ['gh:<tag>'] } })`, they automatically pick
 * up cross-instance invalidation without touching this function again.
 *
 * Swallows errors — invalidation is best-effort; we never want a stale-data
 * fix to throw and break the write that triggered it.
 */
function revalidateTagSafe(tag: string): void {
  try {
    // Lazy require keeps `next/cache` out of client bundles when
    // github-client.ts is transitively imported by a client component
    // (e.g. ModelsManager → variables/models → get-variable → here).
    // Server-side this is a normal sync require; the client never reaches
    // these write paths so the function is effectively a no-op there.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { revalidateTag } =
      require("next/cache") as typeof import("next/cache");
    /* eslint-enable @typescript-eslint/no-require-imports */
    revalidateTag(tag);
  } catch {
    // Outside a request scope (e.g. tests, scripts) revalidateTag throws.
    // The in-process Map invalidation above is the authoritative path here.
  }
}

/**
 * Targeted cache invalidation by category
 * Instead of clearing everything, only clear relevant caches
 */
export function invalidateTaskCache(): void {
  invalidateCache("issues:");
  invalidateCache("issue:");
  invalidateCache("workflows:");
  revalidateTagSafe("gh:issues");
  revalidateTagSafe("gh:workflows");
}

export function invalidatePRCache(): void {
  invalidateCache("pr:");
  invalidateCache("pr-");
  invalidateCache("open-prs:");
  invalidateCache("previews:");
  revalidateTagSafe("gh:prs");
}

export function invalidateBoardCache(): void {
  invalidateCache("boards:");
  invalidateCache("labels:");
  invalidateCache("milestones:");
  revalidateTagSafe("gh:boards");
}

export function invalidateBranchCache(): void {
  invalidateCache("branch:");
  invalidateCache("branches:");
  invalidateCache("refs:");
  revalidateTagSafe("gh:branches");
}

/**
 * Wipe the per-PR "behind base" cache. Called on any push/PR webhook so the
 * next read sees fresh `behind_by` without waiting for TTL — a push to the
 * base branch leaves every open PR potentially out of date.
 */
export function invalidatePRBehindCache(): void {
  invalidateCache("prbehind:");
  revalidateTagSafe("gh:prbehind");
}

/**
 * Invalidate cache entries for a single issue plus every cached issues listing.
 * Use after a write that mutates an issue (or a manifest stored in an issue),
 * so the next read on this serverless instance picks up the change without
 * waiting for the TTL.
 */
export function invalidateIssueCache(issueNumber?: number): void {
  if (typeof issueNumber === "number") {
    // Cache keys are repo-scoped (`issue:owner:repo:N`, `comments:owner:repo:N`).
    // Webhooks don't carry repo context, so wipe across all repos via prefix.
    invalidateCache("issue:");
    invalidateCache("comments:");
    // PRs are issues in the GitHub API — `issue_comment` events fire for PR
    // conversation comments too. The PreviewModal comment list reads from
    // `pr-comments:` (separate prefix from `comments:`), so clear that too.
    invalidateCache("pr-comments:");
    revalidateTagSafe(`gh:issue:${issueNumber}`);
    revalidateTagSafe(`gh:comments:${issueNumber}`);
  }
  invalidateCache("issues:");
  revalidateTagSafe("gh:issues");
}

/**
 * Invalidate cache entries for duty files. Pass a slug to scope to one
 * duty, or omit to clear the listing cache (e.g. on bulk changes).
 */
export function invalidateDutiesCache(slug?: string): void {
  if (typeof slug === "string" && slug.length > 0) {
    // Repo-scoped key shape: `duty:owner:repo:slug`. Wipe across repos.
    invalidateCache("duty:");
    revalidateTagSafe(`gh:duty:${slug}`);
  } else {
    invalidateCache("duties:");
    revalidateTagSafe("gh:duties");
  }
}

/**
 * Invalidate cache entries for staff files. Pass a slug to scope to one
 * staff member, or omit to clear the listing cache (e.g. on bulk changes).
 * Mirrors `invalidateDutiesCache` — staff are an independent feature
 * stored at `.kody/staff/<slug>.md`.
 */
export function invalidateStaffCache(slug?: string): void {
  if (typeof slug === "string" && slug.length > 0) {
    // Repo-scoped key shape: `staff:owner:repo:slug`. Wipe across repos.
    invalidateCache("staff:");
    revalidateTagSafe(`gh:staff:${slug}`);
  } else {
    invalidateCache("staffs:");
    revalidateTagSafe("gh:staffs");
  }
}

/**
 * Invalidate cache entries for prompt files. Pass a slug to scope to one
 * prompt, or omit to clear the listing cache (e.g. on bulk changes).
 * Prompts live at `.kody/commands/<slug>.md` and back the chat slash
 * command menu.
 */
export function invalidateCommandsCache(slug?: string): void {
  if (typeof slug === "string" && slug.length > 0) {
    // Repo-scoped key shape: `prompt:owner:repo:slug`. Wipe across repos.
    invalidateCache("prompt:");
    revalidateTagSafe(`gh:prompt:${slug}`);
  } else {
    invalidateCache("prompts:");
    revalidateTagSafe("gh:prompts");
  }
}

/**
 * Invalidate cache entries for memory files. Pass an id to scope to one
 * memory, or omit to clear the listing/index cache (e.g. on bulk changes).
 */
export function invalidateMemoryCache(id?: string): void {
  if (typeof id === "string" && id.length > 0) {
    // Repo-scoped key shape: `memory:owner:repo:id`. Wipe across repos.
    invalidateCache("memory:");
    revalidateTagSafe(`gh:memory:${id}`);
  } else {
    invalidateCache("memory-index:");
    invalidateCache("memories:");
    revalidateTagSafe("gh:memories");
  }
}

/**
 * Invalidate cache entries for workflow runs and check runs.
 * Use after a webhook arrives signaling a run/job state change.
 */
export function invalidateWorkflowCache(): void {
  invalidateCache("workflows:");
  invalidateCache("checks:");
  invalidateCache("runs:");
  revalidateTagSafe("gh:workflows");
}

// ============ Budget circuit breaker ============
//
// Attach the same pre/post hooks to every Octokit instance so the budget
// snapshot reflects ALL traffic and assertBudget runs before every call.
// `hook.before` throws -> the request is never sent (saves the wall);
// `hook.after` feeds the snapshot from response headers.

function attachBudgetHooks(octokit: Octokit): void {
  // Defensive: tests mock Octokit and may not expose `.hook`.
  const hook = (octokit as { hook?: any }).hook;
  if (!hook || typeof hook.before !== "function") return;
  hook.before("request", (options: any) => {
    assertBudget(methodKind(options?.method));
  });
  hook.after("request", (response: any) => {
    if (response?.headers) {
      recordResponseHeaders(response.headers as Record<string, unknown>);
    }
  });
}

// ============ Per-Request Repo Context ============
//
// The dashboard supports per-user repos (user logs in with their own GitHub
// token and a target repo). Each request carries its own owner/repo/octokit.
//
// This MUST be request-scoped, not a module-level variable. Vercel Fluid
// Compute runs multiple requests concurrently inside one warm instance, so a
// shared variable lets one request's clearGitHubContext() null out another
// request's in-flight Octokit — which surfaces as the flapping
// "GitHub token is not configured" error when several dashboard panels poll at
// once. AsyncLocalStorage gives each request an isolated store that survives
// across awaits and cannot bleed into a concurrent request.

interface GitHubContext {
  owner: string;
  repo: string;
  octokit: Octokit | null;
}

const requestContext = new AsyncLocalStorage<GitHubContext>();

export function getOwner(): string {
  return requestContext.getStore()?.owner ?? GITHUB_OWNER;
}

export function getRepo(): string {
  return requestContext.getStore()?.repo ?? GITHUB_REPO;
}

/**
 * Set the repo context for the current request.
 * API routes MUST call this before any github-client calls and
 * clearGitHubContext() in a finally.
 *
 * Scoped to the current request's async execution via
 * AsyncLocalStorage.enterWith — concurrent requests never share it.
 *
 * @param owner - GitHub repo owner (e.g. "aharonyaircohen")
 * @param repo  - GitHub repo name (e.g. "Kody-ADE-Engine")
 * @param token - GitHub token (user's PAT). Falls back to env token if omitted.
 */
export function setGitHubContext(
  owner: string,
  repo: string,
  token?: string,
): void {
  const authToken =
    token ??
    process.env.KODY_BOT_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_PAT ??
    null;
  if (!authToken) {
    throw new Error(
      "No GitHub token configured. Set KODY_BOT_TOKEN, GITHUB_TOKEN, or GH_PAT.",
    );
  }

  const MyOctokit = Octokit.plugin(throttling);
  const octokit = new MyOctokit({
    auth: authToken,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        if (_options.request?.headers?.["x-octokit-retry-count"] === 0) {
          console.warn(`[Kody] Rate limited, retrying after ${retryAfter}s`);
          return true;
        }
        console.error(`[Kody] Rate limit hit twice, giving up`);
        return false;
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        const retryCount = (_options.request?.retryCount as number) ?? 0;
        if (retryCount < 2) {
          console.warn(
            `[Kody] Secondary rate limit, retrying after ${retryAfter}s (attempt ${retryCount + 1}/2)`,
          );
          return true;
        }
        console.error(
          `[Kody] Secondary rate limit hit ${retryCount + 1} times, giving up`,
        );
        return false;
      },
    },
  });
  attachBudgetHooks(octokit);

  requestContext.enterWith({ owner, repo, octokit });
}

export function clearGitHubContext(): void {
  // Drop this request's Octokit so it can be GC'd. Scoped to the current async
  // context, so it can never clear a concurrent request's context.
  requestContext.enterWith({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    octokit: null,
  });
}

// ============ Octokit Singleton ============

let octokitInstance: Octokit | null = null;

type ThrottledOctokit = Octokit & ReturnType<typeof throttling>;

export function getOctokit(): Octokit {
  // Use the per-request context Octokit when set (via setGitHubContext)
  const ctxOctokit = requestContext.getStore()?.octokit;
  if (ctxOctokit) return ctxOctokit as ThrottledOctokit;
  if (octokitInstance) return octokitInstance as ThrottledOctokit;

  // Prefer KODY_BOT_TOKEN if set (for bot attribution), otherwise fall back to GITHUB_TOKEN / GH_PAT
  const token =
    process.env.KODY_BOT_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_PAT;
  if (!token) {
    throw new Error(
      "No GitHub token configured. Set KODY_BOT_TOKEN, GITHUB_TOKEN, or GH_PAT.",
    );
  }

  // Create Octokit with throttling plugin - auto-retries on rate limits
  const MyOctokit = Octokit.plugin(throttling);
  octokitInstance = new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        // Retry once after rate limit, then stop
        if (_options.request?.headers?.["x-octokit-retry-count"] === 0) {
          console.warn(`[Kody] Rate limited, retrying after ${retryAfter}s`);
          return true;
        }
        console.error(`[Kody] Rate limit hit twice, giving up`);
        return false;
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        // Secondary rate limit (abuse detection) — retry up to 2 times, then stop to avoid token ban
        const retryCount = (_options.request?.retryCount as number) ?? 0;
        if (retryCount < 2) {
          console.warn(
            `[Kody] Secondary rate limit, retrying after ${retryAfter}s (attempt ${retryCount + 1}/2)`,
          );
          return true;
        }
        console.error(
          `[Kody] Secondary rate limit hit ${retryCount + 1} times, giving up to avoid token ban`,
        );
        return false;
      },
    },
  });
  attachBudgetHooks(octokitInstance);

  return octokitInstance as ThrottledOctokit;
}

/**
 * Create a per-request Octokit instance for a user's GitHub token.
 * Used for write operations so they appear under the user's identity.
 * Does NOT cache — each call creates a fresh instance.
 */
export function createUserOctokit(token: string): Octokit {
  const MyOctokit = Octokit.plugin(throttling);
  const instance = new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        if (_options.request?.headers?.["x-octokit-retry-count"] === 0) {
          console.warn(
            `[Kody/User] Rate limited, retrying after ${retryAfter}s`,
          );
          return true;
        }
        console.error(`[Kody/User] Rate limit hit twice, giving up`);
        return false;
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        console.warn(
          `[Kody/User] Secondary rate limit, retrying after ${retryAfter}s`,
        );
        return true;
      },
    },
  });
  attachBudgetHooks(instance);
  return instance;
}

// ============ Branch Discovery ============

/**
 * Load (and cache) the full list of branches under a prefix. Cached for
 * BRANCH_CACHE_TTL so subsequent lookups hit memory, not the GitHub API.
 * Shared by findTaskBranch and findBranchesByIssueNumbers.
 */
async function getBranchesForPrefix(prefix: string): Promise<string[]> {
  const cacheKey = `branches:${getOwner()}:${getRepo()}:prefix:${prefix}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();
  try {
    const { data } = await octokit.git.listMatchingRefs({
      owner: getOwner(),
      repo: getRepo(),
      ref: `heads/${prefix}/`,
    });
    const branches = data.map((ref: any) => ref.ref.replace("refs/heads/", ""));
    setCache(cacheKey, BRANCH_CACHE_TTL, branches);
    return branches;
  } catch {
    return [];
  }
}

/**
 * Find the branch for a task across all known prefixes.
 * Uses cached per-prefix listings — on a warm cache this makes zero API calls.
 */
export async function findTaskBranch(taskId: string): Promise<string | null> {
  if (!TASK_ID_REGEX.test(taskId)) {
    return null;
  }

  const cacheKey = `branch:${getOwner()}:${getRepo()}:task:${taskId}`;
  const cached = getCached<string | null>(cacheKey);
  if (cached !== null) return cached;

  const results = await Promise.all(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix);
      const exact = `${prefix}/${taskId}`;
      const withSuffix = `${prefix}/${taskId}-`;
      return (
        branches.find((b) => b === exact || b.startsWith(withSuffix)) ?? null
      );
    }),
  );

  const found = results.find((r) => r !== null) ?? null;
  setCache(cacheKey, BRANCH_CACHE_TTL, found);
  return found;
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
  const cacheKey = `branch:${getOwner()}:${getRepo()}:issue:${issueNumber}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const issueStr = String(issueNumber);
  const pattern = new RegExp(`-${issueStr}-`);

  // Reuse the shared prefix-branch cache
  const results = await Promise.all(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix);
      return branches.find((b) => pattern.test(b)) ?? null;
    }),
  );

  const found = results.find((r) => r !== null) ?? null;
  if (found) setCache(cacheKey, BRANCH_CACHE_TTL, found);
  return found;
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
  if (issueNumbers.length === 0) return new Map();

  const result = new Map<number, string>();
  const issueStrs = issueNumbers.map((n) => String(n));

  // Fetch (or hit cache for) each prefix's branch list in parallel
  void (await Promise.allSettled(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix);

      for (const issueStr of issueStrs) {
        const pattern = new RegExp(`-${issueStr}-`);
        const match = branches.find((branchName) => pattern.test(branchName));
        if (match) {
          const issueNum = parseInt(issueStr, 10);
          if (!result.has(issueNum)) {
            result.set(issueNum, match);
            const individualCacheKey = `branch:issue:${issueStr}`;
            setCache(individualCacheKey, BRANCH_CACHE_TTL, match);
          }
        }
      }
    }),
  ));

  return result;
}

// ============ Status JSON Access ============

/**
 * Normalize pipeline status data from v2 format.
 * - Derives `currentStage` from stages data if not set (finds the running stage)
 * - Maps `cursor` field to `currentStage` as fallback
 */
export function normalizePipelineStatus(
  status: KodyPipelineStatus,
): KodyPipelineStatus {
  let currentStage = status.currentStage;

  // If currentStage is not set, derive it from stages data
  if (!currentStage && status.stages) {
    const stageEntries = Object.entries(status.stages);

    // 1. Find a stage that is currently running
    const runningEntry = stageEntries.find(
      ([, data]) => data.state === "running",
    );
    if (runningEntry) {
      currentStage = runningEntry[0];
    }

    // 2. Find a paused stage (pipeline gated)
    if (!currentStage) {
      const pausedEntry = stageEntries.find(
        ([, data]) => data.state === "paused",
      );
      if (pausedEntry) {
        currentStage = pausedEntry[0];
      }
    }

    // 3. Derive from stage completion: walk ALL_STAGES in order,
    //    find the first stage with data that is NOT completed/skipped (= where we are now).
    //    Stages without data entries are skipped (they may not be tracked).
    if (!currentStage) {
      for (const stage of ALL_STAGES) {
        const data = status.stages[stage];
        if (!data) continue; // Stage not tracked — skip
        if (data.state !== "completed" && data.state !== "skipped") {
          // This stage hasn't finished — it's the current position
          currentStage = stage;
          break;
        }
      }
    }

    // 4. If ALL known stages are completed/skipped, use the last completed stage
    if (!currentStage && stageEntries.length > 0) {
      let lastCompleted: string | null = null;
      for (const stage of ALL_STAGES) {
        const data = status.stages[stage];
        if (data && (data.state === "completed" || data.state === "skipped")) {
          lastCompleted = stage;
        }
      }
      if (lastCompleted) {
        currentStage = lastCompleted;
      }
    }
  }

  return {
    ...status,
    currentStage,
  };
}

/**
 * Read status.json from a branch.
 *
 * Caching: 60s TTL with ETag/`If-None-Match` revalidation. Polled per active
 * task on every /tasks tick — without 304 support, cache misses each cost a
 * full REST point. With ETag, unchanged status files revalidate for free.
 */
export async function getStatusFromBranch(
  taskId: string,
  branch: string,
): Promise<KodyPipelineStatus | null> {
  const cacheKey = `status:branch:${getOwner()}:${getRepo()}:${taskId}:${branch}`;
  const cached = getCached<KodyPipelineStatus>(cacheKey);
  if (cached) return cached;

  const stale = getStale<KodyPipelineStatus>(cacheKey);
  const octokit = getOctokit();

  try {
    const response = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: `.tasks/${taskId}/status.json`,
      ref: branch,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });

    const data = response.data;
    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;

    if ("content" in data && data.content) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      const raw = JSON.parse(content) as KodyPipelineStatus;
      const status = normalizePipelineStatus(raw);
      setCache(cacheKey, CACHE_TTL.pipeline, status, { etag: newEtag });
      return status;
    }
  } catch (error: any) {
    // 304 Not Modified — file unchanged. Refresh TTL on stale data, no rate cost.
    if (error.status === 304 && stale) {
      setCache(cacheKey, CACHE_TTL.pipeline, stale.data, { etag: stale.etag });
      return stale.data;
    }
    if (error.status !== 404) {
      console.error("[Kody] Error fetching status from branch:", error);
    }
  }

  return null;
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
  // Cache the .tasks/ directory listing separately from the resolved status,
  // so the listing call can revalidate via ETag while different issueNumber
  // queries still get distinct resolved-status caching.
  const listingKey = `status:tasks-listing:${getOwner()}:${getRepo()}:${branch}`;
  const cacheKey = `status:discover:${getOwner()}:${getRepo()}:${branch}:${issueNumber ?? "any"}`;
  const cached = getCached<KodyPipelineStatus>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  // Fetch (or revalidate) the .tasks/ listing with ETag/304.
  let taskDirs: string[] | null = getCached<string[]>(listingKey);
  if (!taskDirs) {
    const stale = getStale<string[]>(listingKey);
    try {
      const response = await octokit.repos.getContent({
        owner: getOwner(),
        repo: getRepo(),
        path: ".tasks",
        ref: branch,
        headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
      });

      const data = response.data;
      const newEtag = (response.headers as Record<string, string | undefined>)
        ?.etag;

      if (Array.isArray(data)) {
        taskDirs = data
          .filter(
            (item: any) => item.type === "dir" && TASK_ID_REGEX.test(item.name),
          )
          .map((item: any) => item.name as string)
          .sort()
          .reverse(); // Newest first (YYMMDD sorts chronologically)
        setCache(listingKey, CACHE_TTL.pipeline, taskDirs, { etag: newEtag });
      }
    } catch (error: any) {
      // 304 Not Modified — directory unchanged. Reuse the stale listing.
      if (error.status === 304 && stale) {
        setCache(listingKey, CACHE_TTL.pipeline, stale.data, {
          etag: stale.etag,
        });
        taskDirs = stale.data;
      } else if (error.status !== 404) {
        console.error("[Kody] Error listing .tasks/ on branch:", error);
      }
    }
  }

  if (!taskDirs || taskDirs.length === 0) return null;

  // Try the newest task directory first (check up to 3).
  // When issueNumber is provided, skip status files belonging to different issues
  // (branches can accumulate status.json files from multiple pipeline runs).
  for (const taskDir of taskDirs.slice(0, 3)) {
    const status = await getStatusFromBranch(taskDir, branch);
    if (status) {
      if (
        issueNumber &&
        status.issueNumber &&
        status.issueNumber !== issueNumber
      )
        continue;
      setCache(cacheKey, CACHE_TTL.pipeline, status);
      return status;
    }
  }

  return null;
}

/**
 * Read `.kody/goals/<id>/state.json` from the default branch with cache +
 * ETag/304 revalidation. Returns `null` when the file is missing (= the
 * engine has never ticked this goal) or unparseable.
 *
 * Uses the polling token (no per-user octokit) because the goals listing
 * route is hot — every poll fetches goals, and per-user reads would
 * multiply the rate-limit cost. The state file lives on the kody-state
 * branch (engine commits it there), so the polling token is sufficient.
 */
export async function fetchGoalStateFromRepo(goalId: string): Promise<{
  goalIssueNumber?: number;
  goalPrUrl?: string;
} | null> {
  if (!goalId || /[\\/]|\.\./.test(goalId)) return null;
  const path = `.kody/goals/${goalId}/state.json`;
  const cacheKey = `goal-state:${getOwner()}:${getRepo()}:${goalId}`;
  const cached = getCached<{
    goalIssueNumber?: number;
    goalPrUrl?: string;
  } | null>(cacheKey);
  if (cached !== null) return cached;

  const stale = getStale<{
    goalIssueNumber?: number;
    goalPrUrl?: string;
  } | null>(cacheKey);
  const octokit = getOctokit();

  try {
    const response = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path,
      ref: STATE_BRANCH,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
    const data = response.data as {
      type?: string;
      encoding?: string;
      content?: string;
    };
    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;
    if (Array.isArray(data) || data.type !== "file" || !data.content) {
      setCache(cacheKey, CACHE_TTL.tasks, null, { etag: newEtag });
      return null;
    }
    const raw = Buffer.from(
      data.content,
      (data.encoding ?? "base64") as BufferEncoding,
    ).toString("utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      setCache(cacheKey, CACHE_TTL.tasks, null, { etag: newEtag });
      return null;
    }
    const goalIssueNumber =
      typeof parsed.goalIssueNumber === "number"
        ? parsed.goalIssueNumber
        : undefined;
    const goalPrUrl =
      typeof parsed.goalPrUrl === "string" && parsed.goalPrUrl.length > 0
        ? parsed.goalPrUrl
        : undefined;
    const result = { goalIssueNumber, goalPrUrl };
    setCache(cacheKey, CACHE_TTL.tasks, result, { etag: newEtag });
    return result;
  } catch (error: any) {
    if (error.status === 304 && stale) {
      setCache(cacheKey, CACHE_TTL.tasks, stale.data, { etag: stale.etag });
      return stale.data;
    }
    if (error.status === 404) {
      setCache(cacheKey, CACHE_TTL.tasks, null);
      return null;
    }
    console.error(`[Kody] Error reading goal state for ${goalId}:`, error);
    return null;
  }
}

/**
 * Read status.json from an artifact
 */
export async function getStatusFromArtifact(
  taskId: string,
  runId: string,
): Promise<KodyPipelineStatus | null> {
  const cacheKey = `status:artifact:${getOwner()}:${getRepo()}:${taskId}:${runId}`;
  const cached = getCached<KodyPipelineStatus>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    // Find artifact
    const { data: artifacts } = await octokit.actions.listWorkflowRunArtifacts({
      owner: getOwner(),
      repo: getRepo(),
      run_id: parseInt(runId),
    });

    const artifact = artifacts.artifacts.find(
      (a: { name: string }) => a.name === `kody-${taskId}-${runId}`,
    );

    if (!artifact) {
      return null;
    }

    // Download artifact
    await octokit.actions.downloadArtifact({
      owner: getOwner(),
      repo: getRepo(),
      artifact_id: artifact.id,
      archive_format: "zipball",
    });

    // Note: In a real implementation, we'd need to extract the zip and parse status.json
    // For now, return null as this requires additional handling
    console.log("[Kody] Artifact download not fully implemented");
    return null;
  } catch (error: any) {
    if (error.status !== 404) {
      console.error("[Kody] Error fetching status from artifact:", error);
    }
  }

  return null;
}

// ============ Issue & Comment Fetching ============

/**
 * Fetch a single issue by number (optimized for detail view).
 *
 * Caching:
 * - Default TTL is `CACHE_TTL.tasks` (2min). Pass `ttl` to shorten it for
 *   endpoints that need fresher data (e.g. goals manifest, duties detail).
 * - When the TTL expires, the cached ETag is replayed via `If-None-Match`.
 *   GitHub returns 304 (free, doesn't count against the rate limit) when the
 *   issue is unchanged, and we just refresh the TTL on the existing payload.
 * - `noCache` skips the cache entirely (rarely needed; prefer `ttl`).
 */
export async function fetchIssue(
  issueNumber: number,
  options?: { noCache?: boolean; ttl?: number },
): Promise<GitHubIssue | null> {
  const cacheKey = `issue:${getOwner()}:${getRepo()}:${issueNumber}`;
  const ttl = options?.ttl ?? CACHE_TTL.tasks;

  if (!options?.noCache) {
    const cached = getCached<GitHubIssue>(cacheKey);
    if (cached) return cached;
  }

  const stale = options?.noCache ? null : getStale<GitHubIssue>(cacheKey);
  const octokit = getOctokit();

  let response;
  try {
    response = await octokit.issues.get({
      owner: getOwner(),
      repo: getRepo(),
      issue_number: issueNumber,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
  } catch (error: any) {
    if (error.status === 304 && stale) {
      setCache(cacheKey, ttl, stale.data, { etag: stale.etag });
      return stale.data;
    }
    if (error.status === 404) {
      return null;
    }
    throw error;
  }

  const data = response.data;
  const newEtag = (response.headers as Record<string, string | undefined>)
    ?.etag;

  const issue: GitHubIssue = {
    id: data.id,
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    state: data.state as "open" | "closed",
    labels: data.labels.map((l: any) =>
      typeof l === "string"
        ? { name: l, color: "000000" }
        : { name: l.name ?? "", color: l.color ?? "000000" },
    ),
    milestone: data.milestone ? { title: data.milestone.title ?? "" } : null,
    assignees:
      data.assignees?.map((a: any) => ({
        login: a.login ?? "",
        avatar_url: a.avatar_url ?? "",
      })) ?? [],
    created_at: data.created_at ?? "",
    updated_at: data.updated_at ?? "",
    closed_at: data.closed_at ?? null,
    html_url: data.html_url ?? "",
    isKodyAssigned:
      data.assignees?.some(
        (a: any) =>
          a.login === "github-actions[bot]" ||
          a.login === "Copilot" ||
          (a as any).type === "Bot",
      ) ?? false,
  };

  if (!options?.noCache) {
    setCache(cacheKey, ttl, issue, { etag: newEtag });
  }
  return issue;
}

/**
 * Fetch issues with optional filters.
 *
 * Caching:
 * - Default TTL is `CACHE_TTL.tasks` (2min). Pass `ttl` to shorten it for
 *   endpoints that need fresher data (e.g. goals/duties list).
 * - Post-TTL revalidation replays the cached ETag via `If-None-Match`. GitHub
 *   returns 304 (free, doesn't count against the rate limit) when the listing
 *   is unchanged, and the TTL is refreshed on the existing payload.
 * - `noCache` skips the cache entirely (rarely needed; prefer `ttl`).
 */
export async function fetchIssues(options?: {
  state?: "open" | "closed" | "all";
  labels?: string;
  excludeLabels?: string[];
  milestone?: number;
  perPage?: number;
  since?: string; // ISO 8601 date string - only returns issues updated after this date
  ttl?: number;
  noCache?: boolean;
}): Promise<GitHubIssue[]> {
  const { noCache, ttl: ttlOpt, ...rest } = options ?? {};
  const cacheKey = `issues:${getOwner()}:${getRepo()}:${JSON.stringify(rest)}`;
  const ttl = ttlOpt ?? CACHE_TTL.tasks;

  if (!noCache) {
    const cached = getCached<GitHubIssue[]>(cacheKey);
    if (cached) return cached;
  }

  const stale = noCache ? null : getStale<GitHubIssue[]>(cacheKey);
  const octokit = getOctokit();

  let response;
  try {
    response = await octokit.issues.listForRepo({
      owner: getOwner(),
      repo: getRepo(),
      state: options?.state || "open",
      labels: options?.labels,
      milestone: options?.milestone ? String(options.milestone) : undefined,
      per_page: options?.perPage || 50,
      sort: "updated",
      direction: "desc",
      since: options?.since as any, // Octokit accepts ISO string
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
  } catch (err: any) {
    // 304 Not Modified — reuse stale data, refresh TTL, no rate cost
    if (err.status === 304 && stale) {
      setCache(cacheKey, ttl, stale.data, { etag: stale.etag });
      return stale.data;
    }
    throw err;
  }

  const data = response.data;
  const newEtag = (response.headers as Record<string, string | undefined>)
    ?.etag;

  const excludeSet = new Set(
    (options?.excludeLabels ?? []).map((l) => l.toLowerCase()),
  );

  // Filter out pull requests — GitHub issues API returns both issues and PRs
  // Also drop issues that carry any of the excluded labels (post-fetch because
  // the REST API's `labels` param only supports intersection, not negation).
  const issues: GitHubIssue[] = data
    .filter((issue: any) => !issue.pull_request)
    .filter((issue: any) => {
      if (excludeSet.size === 0) return true;
      const names: string[] = (issue.labels ?? []).map((l: any) =>
        (typeof l === "string" ? l : (l.name ?? "")).toLowerCase(),
      );
      return !names.some((n) => excludeSet.has(n));
    })
    .map((issue: any) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state as "open" | "closed",
      labels: issue.labels.map((l: any) =>
        typeof l === "string"
          ? { name: l, color: "000000" }
          : { name: l.name ?? "", color: l.color ?? "000000" },
      ),
      milestone: issue.milestone
        ? { title: issue.milestone.title ?? "" }
        : null,
      assignees:
        issue.assignees?.map((a: any) => ({
          login: a.login ?? "",
          avatar_url: a.avatar_url ?? "",
        })) ?? [],
      created_at: issue.created_at ?? "",
      updated_at: issue.updated_at ?? "",
      closed_at: issue.closed_at ?? null,
      html_url: issue.html_url ?? "",
      isKodyAssigned:
        issue.assignees?.some(
          (a: any) =>
            a.login === "github-actions[bot]" ||
            a.login === "Copilot" ||
            a.type === "Bot",
        ) ?? false,
    }));

  // Fallback: GitHub's REST `/repos/{owner}/{repo}/issues` listing has gone
  // wrong globally before (returns `[]` for repos with open issues). When the
  // REST listing is empty, retry once via GraphQL — which uses a separate
  // backend and stays up. We only do this on the empty path so genuinely
  // empty repos still take the cheap REST path.
  let finalIssues = issues;
  if (issues.length === 0) {
    try {
      const gql = await fetchIssuesViaGraphQL({
        state: options?.state ?? "open",
        labels: options?.labels,
        excludeLabels: options?.excludeLabels,
        perPage: options?.perPage ?? 50,
      });
      if (gql.length > 0) {
        finalIssues = gql;
      }
    } catch {
      // Fall through to the empty REST result; never let the fallback fail loud.
    }
  }

  if (!noCache) {
    // Only cache the ETag when the REST result was authoritative. The
    // GraphQL fallback path has no ETag, so we cache without one and let
    // the TTL drive the next refresh.
    if (finalIssues === issues) {
      setCache(cacheKey, ttl, finalIssues, { etag: newEtag });
    } else {
      setCache(cacheKey, ttl, finalIssues);
    }
  }
  return finalIssues;
}

interface GraphQLIssuesResponse {
  repository: {
    issues: {
      nodes: Array<{
        databaseId: number;
        number: number;
        title: string;
        body: string | null;
        state: "OPEN" | "CLOSED";
        url: string;
        createdAt: string;
        updatedAt: string;
        closedAt: string | null;
        labels: { nodes: Array<{ name: string; color: string }> };
        milestone: { title: string } | null;
        assignees: { nodes: Array<{ login: string; avatarUrl: string }> };
      }>;
    };
  };
}

/**
 * GraphQL fallback for fetchIssues. Used only when the REST listing is empty
 * — see comment in fetchIssues for why. Uses a separate GraphQL rate-limit
 * bucket. No ETag/304 (GraphQL doesn't expose them).
 */
async function fetchIssuesViaGraphQL(opts: {
  state: "open" | "closed" | "all";
  labels?: string;
  excludeLabels?: string[];
  perPage: number;
}): Promise<GitHubIssue[]> {
  const states =
    opts.state === "all"
      ? "[OPEN, CLOSED]"
      : opts.state === "closed"
        ? "[CLOSED]"
        : "[OPEN]";
  const first = Math.min(opts.perPage, 100);

  // GraphQL accepts a `labels: [String!]` filter on issues(). Mirror REST's
  // comma-separated `labels=a,b` semantics: results match all listed labels.
  const labelList = opts.labels
    ? opts.labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  const labelsArg = labelList.length
    ? `, labels: [${labelList.map((l) => JSON.stringify(l)).join(", ")}]`
    : "";

  const query = `
    query Issues($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        issues(first: ${first}, states: ${states}${labelsArg}, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            databaseId
            number
            title
            body
            state
            url
            createdAt
            updatedAt
            closedAt
            labels(first: 30) { nodes { name color } }
            milestone { title }
            assignees(first: 10) { nodes { login avatarUrl } }
          }
        }
      }
    }
  `;

  const octokit = getOctokit();
  const data = await octokit.graphql<GraphQLIssuesResponse>(query, {
    owner: getOwner(),
    repo: getRepo(),
  });

  const excludeSet = new Set(
    (opts.excludeLabels ?? []).map((l) => l.toLowerCase()),
  );

  return data.repository.issues.nodes
    .filter((node) => {
      if (excludeSet.size === 0) return true;
      const names = node.labels.nodes.map((l) => (l.name ?? "").toLowerCase());
      return !names.some((n) => excludeSet.has(n));
    })
    .map((node): GitHubIssue => {
      const assigneeLogins = node.assignees.nodes.map((a) => ({
        login: a.login ?? "",
        avatar_url: a.avatarUrl ?? "",
      }));
      return {
        id: node.databaseId,
        number: node.number,
        title: node.title,
        body: node.body ?? null,
        state: node.state.toLowerCase() as "open" | "closed",
        labels: node.labels.nodes.map((l) => ({
          name: l.name ?? "",
          color: l.color ?? "000000",
        })),
        milestone: node.milestone ? { title: node.milestone.title } : null,
        assignees: assigneeLogins,
        created_at: node.createdAt ?? "",
        updated_at: node.updatedAt ?? "",
        closed_at: node.closedAt,
        html_url: node.url ?? "",
        isKodyAssigned: assigneeLogins.some(
          (a) => a.login === "github-actions[bot]" || a.login === "Copilot",
        ),
      };
    });
}

/**
 * Fetch comments for an issue
 */
export async function fetchComments(
  issueNumber: number,
): Promise<GitHubComment[]> {
  const cacheKey = `comments:${getOwner()}:${getRepo()}:${issueNumber}`;
  const ttl = CACHE_TTL.tasks * 2;
  const cached = getCached<GitHubComment[]>(cacheKey);
  if (cached) return cached;

  // Stale-with-ETag path: post-TTL revalidation replays the cached ETag via
  // `If-None-Match`. GitHub returns 304 (free, no rate cost) when comments
  // haven't changed, and we refresh TTL on the existing payload. This was a
  // hot rate-limit drain when the fallback task lookup batched dozens of
  // comment fetches per request.
  const stale = getStale<GitHubComment[]>(cacheKey);
  const octokit = getOctokit();

  let response;
  try {
    response = await octokit.issues.listComments({
      owner: getOwner(),
      repo: getRepo(),
      issue_number: issueNumber,
      per_page: 100,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
  } catch (err: any) {
    if (err.status === 304 && stale) {
      setCache(cacheKey, ttl, stale.data, { etag: stale.etag });
      return stale.data;
    }
    throw err;
  }

  const data = response.data;
  const newEtag = (response.headers as Record<string, string | undefined>)
    ?.etag;

  const comments: GitHubComment[] = data.map((comment: any) => ({
    id: comment.id,
    body: comment.body ?? "",
    created_at: comment.created_at ?? "",
    updated_at: comment.updated_at ?? comment.created_at ?? "",
    user: {
      login: comment.user?.login ?? "unknown",
      type: comment.user?.type ?? "User",
      avatar_url: comment.user?.avatar_url ?? "",
    },
  }));

  // Comments are less likely to change, cache longer
  setCache(cacheKey, ttl, comments, { etag: newEtag });
  return comments;
}

/**
 * Fetch the canonical kody TaskState for an issue. Returns null when the
 * engine has not written its state comment (legacy issues, non-kody issues,
 * or fetch errors — caller falls back to label/workflow-run derivation).
 *
 * Reuses fetchComments' ETag/304 cache, so polling cost is bounded: the first
 * call per issue costs one REST request; subsequent calls return 304 (free)
 * until the comment is edited.
 */
export async function fetchKodyState(
  issueNumber: number,
): Promise<import("./kody-state").KodyTaskState | null> {
  try {
    const { findKodyStateInComments } = await import("./kody-state");
    const comments = await fetchComments(issueNumber);
    return findKodyStateInComments(comments);
  } catch (err) {
    // Best effort — falling back to label/run derivation is acceptable.
    console.warn(`[fetchKodyState] failed for #${issueNumber}:`, err);
    return null;
  }
}

// ============ Workflow Runs ============

/**
 * Fetch workflow runs for the Kody workflow
 */
export async function fetchWorkflowRuns(options?: {
  status?: "queued" | "in_progress" | "completed";
  perPage?: number;
}): Promise<WorkflowRun[]> {
  const cacheKey = `workflows:${getOwner()}:${getRepo()}:${JSON.stringify(options)}`;
  const cached = getCached<WorkflowRun[]>(cacheKey);
  if (cached) return cached;

  const stale = getStale<WorkflowRun[]>(cacheKey);
  const octokit = getOctokit();

  let response;
  try {
    response = await octokit.actions.listWorkflowRuns({
      owner: getOwner(),
      repo: getRepo(),
      workflow_id: WORKFLOW_ID,
      status: options?.status,
      per_page: options?.perPage || 20,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
  } catch (err: any) {
    if (err.status === 304 && stale) {
      setCache(cacheKey, CACHE_TTL.pipeline, stale.data, { etag: stale.etag });
      return stale.data;
    }
    throw err;
  }

  const data = response.data;
  const newEtag = (response.headers as Record<string, string | undefined>)
    ?.etag;

  const runs: WorkflowRun[] = data.workflow_runs.map((run) => ({
    id: run.id,
    status: run.status as "queued" | "in_progress" | "completed",
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
    display_title: (run as any).display_title ?? "",
    head_branch: (run as any).head_branch ?? undefined,
    event: (run as any).event ?? undefined,
    run_number: (run as any).run_number ?? undefined,
    run_attempt: (run as any).run_attempt ?? undefined,
    actor: (run as any).triggering_actor?.login ?? (run as any).actor?.login,
  }));

  setCache(cacheKey, CACHE_TTL.pipeline, runs, { etag: newEtag });
  return runs;
}

// ============ Default-branch CI roll-up ============
//
// Used by the dashboard banner to surface whether `main` is currently green
// or red. Autonomous agents start work from the default branch, so a red
// main is a blocker — operators want to see this before drilling into tasks.
//
// Cached with ETag/304 + 30s TTL per the rate-limit rules in CLAUDE.md.
// Webhook receiver invalidates via invalidateWorkflowCache() on workflow_run /
// check_run / push events.

export interface DefaultBranchCI {
  /** Aggregate state across the latest run of each distinct workflow on main. */
  state: "success" | "failure" | "pending" | "unknown";
  /** Default branch name (usually 'main'). */
  branch: string;
  /** Latest commit SHA on the default branch (when known). */
  sha?: string;
  /** Latest workflow run on main, regardless of conclusion. */
  latestRun?: {
    id: number;
    name: string;
    status: "queued" | "in_progress" | "completed";
    conclusion: string | null;
    html_url: string;
    updated_at: string;
  };
  /** All currently-failing latest-runs on main. Empty when state !== 'failure'. */
  failingRuns: Array<{
    id: number;
    name: string;
    conclusion: string;
    html_url: string;
    updated_at: string;
  }>;
  /** When data was sampled (ISO). */
  fetchedAt: string;
}

const DEFAULT_BRANCH_CI_TTL = 30_000;

async function getDefaultBranch(): Promise<string> {
  const cacheKey = `branch:default:${getOwner()}:${getRepo()}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const { data } = await getOctokit().repos.get({
    owner: getOwner(),
    repo: getRepo(),
  });
  const branch = data.default_branch;
  setCache(cacheKey, BRANCH_CACHE_TTL, branch);
  return branch;
}

interface DefaultBranchCIGraphQL {
  repository: {
    defaultBranchRef: {
      name: string;
      target: {
        oid: string;
        statusCheckRollup: {
          state: "EXPECTED" | "ERROR" | "FAILURE" | "PENDING" | "SUCCESS";
          contexts: {
            nodes: Array<
              | {
                  __typename: "CheckRun";
                  name: string;
                  status:
                    | "QUEUED"
                    | "IN_PROGRESS"
                    | "COMPLETED"
                    | "WAITING"
                    | "PENDING"
                    | "REQUESTED";
                  conclusion:
                    | "ACTION_REQUIRED"
                    | "TIMED_OUT"
                    | "CANCELLED"
                    | "FAILURE"
                    | "SUCCESS"
                    | "NEUTRAL"
                    | "SKIPPED"
                    | "STARTUP_FAILURE"
                    | "STALE"
                    | null;
                  permalink: string;
                  startedAt: string | null;
                  completedAt: string | null;
                }
              | {
                  __typename: "StatusContext";
                  context: string;
                  state:
                    | "EXPECTED"
                    | "ERROR"
                    | "FAILURE"
                    | "PENDING"
                    | "SUCCESS";
                  targetUrl: string | null;
                  createdAt: string;
                }
            >;
          };
        } | null;
      } | null;
    } | null;
  };
}

/**
 * Roll-up of CI status at HEAD of the default branch.
 *
 * Uses GraphQL `statusCheckRollup` — the exact field GitHub uses to render the
 * green/red checkmark on a commit. This folds together check runs, statuses,
 * and required-checks rules, so the banner mirrors what you see on the commit
 * page in GitHub.
 *
 * Earlier iterations queried `actions.listWorkflowRunsForRepo` (returned stale
 * runs from disabled workflows) and `checks.listForRef` (returned check runs
 * that GitHub's UI sometimes intentionally ignores in the rollup). Neither
 * matched the visible status, so the banner reported failure when the commit
 * was actually green.
 */
export async function fetchDefaultBranchCI(): Promise<DefaultBranchCI> {
  const branch = await getDefaultBranch();
  const cacheKey = `workflows:main-ci:${getOwner()}:${getRepo()}:${branch}`;
  const cached = getCached<DefaultBranchCI>(cacheKey);
  if (cached) return cached;

  const stale = getStale<DefaultBranchCI>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query DefaultBranchCI($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        defaultBranchRef {
          name
          target {
            ... on Commit {
              oid
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      permalink
                      startedAt
                      completedAt
                    }
                    ... on StatusContext {
                      context
                      state
                      targetUrl
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  let data: DefaultBranchCIGraphQL;
  try {
    data = await octokit.graphql<DefaultBranchCIGraphQL>(query, {
      owner: getOwner(),
      repo: getRepo(),
    });
  } catch {
    // Refresh TTL on the stale entry so GraphQL throttling doesn't compound
    // (CLAUDE.md rule 3 — GraphQL has its own bucket and no 304 escape hatch).
    if (stale) {
      setCache(cacheKey, DEFAULT_BRANCH_CI_TTL, stale.data);
      return stale.data;
    }
    throw new Error("Failed to fetch default-branch CI rollup");
  }

  const ref = data.repository.defaultBranchRef;
  const target = ref?.target;
  const rollup = target?.statusCheckRollup;

  if (!ref || !target || !rollup) {
    // No commit on default branch yet, or the commit has no checks/statuses.
    // Treat as 'unknown' so the banner reads cleanly.
    const result: DefaultBranchCI = {
      state: "unknown",
      branch: ref?.name ?? branch,
      sha: target?.oid,
      failingRuns: [],
      fetchedAt: new Date().toISOString(),
    };
    setCache(cacheKey, DEFAULT_BRANCH_CI_TTL, result);
    return result;
  }

  let state: DefaultBranchCI["state"];
  switch (rollup.state) {
    case "SUCCESS":
      state = "success";
      break;
    case "FAILURE":
    case "ERROR":
      state = "failure";
      break;
    case "PENDING":
    case "EXPECTED":
      state = "pending";
      break;
    default:
      state = "unknown";
  }

  const failingRuns: DefaultBranchCI["failingRuns"] = [];
  let mostRecent:
    | {
        id: number;
        name: string;
        status: "queued" | "in_progress" | "completed";
        conclusion: string | null;
        html_url: string;
        updated_at: string;
      }
    | undefined;

  for (const node of rollup.contexts.nodes) {
    if (node.__typename === "CheckRun") {
      const ts = node.completedAt ?? node.startedAt ?? new Date().toISOString();
      const checkStatus =
        node.status === "COMPLETED"
          ? "completed"
          : node.status === "IN_PROGRESS"
            ? "in_progress"
            : "queued";
      const isFailure =
        node.conclusion === "FAILURE" ||
        node.conclusion === "TIMED_OUT" ||
        node.conclusion === "ACTION_REQUIRED" ||
        node.conclusion === "STARTUP_FAILURE";
      if (isFailure && node.conclusion) {
        failingRuns.push({
          id: 0,
          name: node.name,
          conclusion: node.conclusion.toLowerCase(),
          html_url: node.permalink,
          updated_at: ts,
        });
      }
      if (!mostRecent || ts > mostRecent.updated_at) {
        mostRecent = {
          id: 0,
          name: node.name,
          status: checkStatus,
          conclusion: node.conclusion ? node.conclusion.toLowerCase() : null,
          html_url: node.permalink,
          updated_at: ts,
        };
      }
    } else {
      // StatusContext — legacy commit-status API (e.g. external CI integrations).
      const isFailure = node.state === "FAILURE" || node.state === "ERROR";
      const checkStatus =
        node.state === "PENDING" ? "in_progress" : "completed";
      if (isFailure) {
        failingRuns.push({
          id: 0,
          name: node.context,
          conclusion: node.state.toLowerCase(),
          html_url: node.targetUrl ?? "",
          updated_at: node.createdAt,
        });
      }
      if (!mostRecent || node.createdAt > mostRecent.updated_at) {
        mostRecent = {
          id: 0,
          name: node.context,
          status: checkStatus,
          conclusion: node.state.toLowerCase(),
          html_url: node.targetUrl ?? "",
          updated_at: node.createdAt,
        };
      }
    }
  }

  // Sanity: if the rollup says SUCCESS, drop any stragglers we collected as
  // 'failing'. statusCheckRollup is authoritative — individual contexts may be
  // marked failure but ignored by GitHub's rollup (e.g. soft-failure required
  // checks, contexts superseded by a later run).
  const reconciledFailingRuns = state === "success" ? [] : failingRuns;

  const result: DefaultBranchCI = {
    state,
    branch: ref.name,
    sha: target.oid,
    latestRun: mostRecent,
    failingRuns: reconciledFailingRuns,
    fetchedAt: new Date().toISOString(),
  };

  setCache(cacheKey, DEFAULT_BRANCH_CI_TTL, result);
  return result;
}

/**
 * Get workflow run for a specific task
 */
export async function getWorkflowRunForTask(
  taskId: string,
): Promise<WorkflowRun | null> {
  const runs = await fetchWorkflowRuns({ perPage: 50 });
  // Look for run with the task ID in the head_branch or workflow run name
  return (
    runs.find(
      (run) =>
        run.html_url.includes(taskId) || taskId.includes(run.id.toString()),
    ) || null
  );
}

/**
 * Fetch check runs (lint, test, typecheck, etc.) for a workflow run
 */
export async function fetchCheckRunsForRun(
  runId: number,
): Promise<CheckRunResult[]> {
  const cacheKey = `check-runs:${getOwner()}:${getRepo()}:${runId}`;
  const cached = getCached<CheckRunResult[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    // Get jobs for the workflow run - these contain lint, test, typecheck results
    const { data } = await octokit.actions.listJobsForWorkflowRun({
      owner: getOwner(),
      repo: getRepo(),
      run_id: runId,
      per_page: 50,
    });

    const checkRuns: CheckRunResult[] = (data.jobs as any[]).map((job) => ({
      name: job.name,
      status: job.status as "queued" | "in_progress" | "completed",
      conclusion: job.conclusion as CheckRunResult["conclusion"],
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
    }));

    setCache(cacheKey, CACHE_TTL.pipeline, checkRuns);
    return checkRuns;
  } catch (error) {
    console.error("[Kody] Error fetching check runs:", error);
    return [];
  }
}

// ============ Bulk PR Fetch ============

type CIStatus = "pending" | "success" | "failure" | "running";

type MergeStateStatus =
  | "CLEAN"
  | "DIRTY"
  | "BLOCKED"
  | "BEHIND"
  | "UNKNOWN"
  | "UNSTABLE"
  | "HAS_HOOKS";

type RollupState = "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED";

interface OpenPRsGraphQL {
  repository: {
    pullRequests: {
      nodes: Array<{
        databaseId: number;
        number: number;
        title: string;
        state: "OPEN" | "CLOSED" | "MERGED";
        url: string;
        mergedAt: string | null;
        headRefName: string;
        headRefOid: string;
        baseRefName: string;
        body: string | null;
        mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
        mergeStateStatus: MergeStateStatus;
        labels: { nodes: Array<{ name: string }> };
        closingIssuesReferences: { nodes: Array<{ number: number }> };
        commits: {
          nodes: Array<{
            commit: {
              statusCheckRollup: { state: RollupState } | null;
            };
          }>;
        };
      }>;
    };
  };
}

function mapRollupState(state: RollupState | null | undefined): CIStatus {
  if (!state) return "success"; // no checks configured — nothing to wait for
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
      return "running";
    case "EXPECTED":
    default:
      return "pending";
  }
}

/**
 * Derive CI status + mergeability from GitHub's mergeStateStatus and the
 * statusCheckRollup. Centralized here so both /tasks and consumers see a
 * single source of truth for the CI badge / merge-button state.
 */
function derivePRCi(input: {
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: MergeStateStatus;
  rollupState: RollupState | null;
}): { ciStatus: CIStatus; mergeable: boolean; hasConflicts: boolean } {
  const noConflicts = input.mergeable === "MERGEABLE";
  let ciStatus: CIStatus;
  let hasConflicts = false;

  switch (input.mergeStateStatus) {
    case "CLEAN":
      ciStatus = "success";
      break;
    case "UNSTABLE":
      // Mergeable, non-required check failed — surface real CI status.
      ciStatus = mapRollupState(input.rollupState);
      break;
    case "BLOCKED":
      // Steady state for repos without branch protection — fall back to rollup.
      ciStatus = noConflicts ? mapRollupState(input.rollupState) : "running";
      break;
    case "BEHIND":
    case "HAS_HOOKS":
      ciStatus = "running";
      break;
    case "DIRTY":
      ciStatus = "failure";
      hasConflicts = true;
      break;
    case "UNKNOWN":
    default:
      ciStatus = "pending";
  }

  const mergeable =
    noConflicts &&
    ciStatus !== "pending" &&
    ciStatus !== "running" &&
    (ciStatus === "success" ||
      input.mergeStateStatus === "CLEAN" ||
      input.mergeStateStatus === "UNSTABLE");

  return { ciStatus, mergeable, hasConflicts };
}

// Non-closing issue references in PR bodies. Currently:
//   Tracking-Issue: #1352
// The release-prepare script writes this so the dashboard can preview the
// release PR on the originating issue's task without auto-closing the issue
// on merge (see kody2/src/executables/release-prepare/prepare.sh).
const TRACKING_ISSUE_RE = /(?:^|\n)\s*Tracking-Issue\s*:\s*#(\d+)\b/gi;

function parseTrackingIssueRefs(body: string | null | undefined): number[] {
  if (!body) return [];
  const out = new Set<number>();
  for (const m of body.matchAll(TRACKING_ISSUE_RE)) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
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
const inflightOpenPRs = new Map<string, Promise<GitHubPR[]>>();

export async function fetchOpenPRs(): Promise<GitHubPR[]> {
  const cacheKey = `open-prs:${getOwner()}:${getRepo()}`;
  const cached = getCached<GitHubPR[]>(cacheKey);
  if (cached) return cached;

  const existing = inflightOpenPRs.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<GitHubPR[]>(cacheKey);
  const octokit = getOctokit();

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
            baseRefName
            body
            mergeable
            mergeStateStatus
            labels(first: 20) { nodes { name } }
            closingIssuesReferences(first: 10) { nodes { number } }
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
    }
  `;

  const promise = (async () => {
    try {
      const data = await octokit.graphql<OpenPRsGraphQL>(query, {
        owner: getOwner(),
        repo: getRepo(),
      });

      const prs: GitHubPR[] = data.repository.pullRequests.nodes.map((pr) => {
        const rollupState =
          pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null;
        const ci = derivePRCi({
          mergeable: pr.mergeable,
          mergeStateStatus: pr.mergeStateStatus,
          rollupState,
        });
        return {
          id: pr.databaseId,
          number: pr.number,
          title: pr.title,
          state: pr.state.toLowerCase(),
          head: { ref: pr.headRefName, sha: pr.headRefOid },
          base: { ref: pr.baseRefName },
          merged_at: pr.mergedAt,
          html_url: pr.url,
          labels: pr.labels.nodes.map((l) => l.name).filter(Boolean),
          closingIssueNumbers: pr.closingIssuesReferences.nodes.map(
            (n) => n.number,
          ),
          trackingIssueNumbers: parseTrackingIssueRefs(pr.body),
          ciStatus: ci.ciStatus,
          mergeable: ci.mergeable,
          hasConflicts: ci.hasConflicts,
        };
      });

      setCache(cacheKey, CACHE_TTL.prs, prs);
      return prs;
    } catch (err) {
      if (stale) {
        // Refresh the TTL on stale data so we don't hammer GraphQL on every
        // subsequent poll while we're being throttled.
        setCache(cacheKey, Math.min(CACHE_TTL.prs, 60_000), stale.data);
        return stale.data;
      }
      throw err;
    } finally {
      inflightOpenPRs.delete(cacheKey);
    }
  })();

  inflightOpenPRs.set(cacheKey, promise);
  return promise;
}

/**
 * Read the engine-authored Company Activity log — recent
 * `.kody/activity/<date>.jsonl` files committed by `appendCompanyActivity`.
 * Lists the dir, reads the newest few day-files, parses + merges newest-first.
 * Each file is ETag/304-cached (rate-limit rule #2). Returns [] when the dir
 * doesn't exist yet (no engine ticks recorded).
 */
const ACTIVITY_DIR = ".kody/activity";
const ACTIVITY_DAY_FILES = 3;

export async function fetchCompanyActivity(
  limit = 100,
): Promise<CompanyActivityRecord[]> {
  const octokit = getOctokit();
  const owner = getOwner();
  const repo = getRepo();

  // List the activity dir (ETag-cached). 404 = nothing recorded yet.
  const listKey = `activity-dir:${owner}:${repo}`;
  const listStale = getStale<string[]>(listKey);
  let files: string[] = listStale?.data ?? [];
  try {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path: ACTIVITY_DIR,
      // Engine commits the activity feed to the dedicated state branch.
      ref: STATE_BRANCH,
      headers: listStale?.etag
        ? { "If-None-Match": listStale.etag }
        : undefined,
    });
    const etag = (res.headers as Record<string, string | undefined>)?.etag;
    if (Array.isArray(res.data)) {
      files = res.data
        .filter((e) => e.type === "file" && e.name.endsWith(".jsonl"))
        .map((e) => e.name);
      setCache(listKey, CACHE_TTL.tasks, files, { etag });
    }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 304 && listStale) {
      setCache(listKey, CACHE_TTL.tasks, listStale.data, {
        etag: listStale.etag,
      });
      files = listStale.data;
    } else if (status === 404) {
      return [];
    } else if (!listStale) {
      return [];
    }
  }

  // Newest day-files first (filenames are YYYY-MM-DD.jsonl → lexicographic).
  const recent = [...files].sort().reverse().slice(0, ACTIVITY_DAY_FILES);

  const perFile = await Promise.all(
    recent.map(async (name) => {
      const path = `${ACTIVITY_DIR}/${name}`;
      const key = `activity-file:${owner}:${repo}:${name}`;
      const stale = getStale<CompanyActivityRecord[]>(key);
      try {
        const res = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: STATE_BRANCH,
          headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
        });
        const etag = (res.headers as Record<string, string | undefined>)?.etag;
        const data = res.data;
        if (!Array.isArray(data) && "content" in data && data.content) {
          const text = Buffer.from(data.content, "base64").toString("utf-8");
          const recs = parseActivityJsonl(text);
          setCache(key, CACHE_TTL.tasks, recs, { etag });
          return recs;
        }
      } catch (error: unknown) {
        const status = (error as { status?: number })?.status;
        if (status === 304 && stale) {
          setCache(key, CACHE_TTL.tasks, stale.data, { etag: stale.etag });
          return stale.data;
        }
        if (stale) return stale.data;
      }
      return [];
    }),
  );

  return sortActivityNewestFirst(perFile.flat()).slice(0, limit);
}

/**
 * Returns how many commits the PR head branch is behind its base. Used to
 * gate the Preview "Sync" button — when 0, the branch is already up to date
 * and the button is hidden.
 *
 * Cheap to call: 60s TTL with ETag/304 revalidation, so subsequent polls
 * only re-bill the rate limit when the comparison actually changes. Fails
 * soft to 0 (treat as up-to-date) on transient errors so we don't surface
 * a stale Sync button.
 */
const PR_BEHIND_TTL = 60_000;

export async function fetchPRBehind(
  base: string,
  head: string,
): Promise<number> {
  const cacheKey = `prbehind:${getOwner()}:${getRepo()}:${base}...${head}`;
  const cached = getCached<number>(cacheKey);
  if (cached !== null) return cached;

  const stale = getStale<number>(cacheKey);
  const octokit = getOctokit();

  try {
    const response = await octokit.repos.compareCommitsWithBasehead({
      owner: getOwner(),
      repo: getRepo(),
      basehead: `${base}...${head}`,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
    const behindBy = response.data.behind_by ?? 0;
    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;
    setCache(cacheKey, PR_BEHIND_TTL, behindBy, { etag: newEtag });
    return behindBy;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 304 && stale) {
      setCache(cacheKey, PR_BEHIND_TTL, stale.data, { etag: stale.etag });
      return stale.data;
    }
    if (stale) {
      setCache(cacheKey, PR_BEHIND_TTL, stale.data);
      return stale.data;
    }
    throw err;
  }
}

// ============ Vercel Preview URLs ============

type DeploymentSummary = { id: number; sha: string };

// Short TTL for the deployments list and per-deployment status: a new PR
// commit creates a new deployment within seconds, and we want the dashboard
// to surface its preview URL on the next /tasks poll. With ETag/304 the
// short TTL is essentially free — unchanged data revalidates without
// counting against the rate limit.
const PREVIEW_REVALIDATE_TTL = 30_000;

/**
 * Fetch (or revalidate via ETag) the most recent 100 Preview deployments.
 * Cached by owner/repo only — independent of which SHAs the caller wants —
 * so a new PR push doesn't invalidate the entire derived view, just forces
 * a cheap 200 (when truly new) or 304 (free) on the underlying list.
 */
async function getRecentPreviewDeployments(): Promise<DeploymentSummary[]> {
  // Prefix with `previews:` so invalidatePRCache() catches this key.
  const cacheKey = `previews:list:${getOwner()}:${getRepo()}`;
  const cached = getCached<DeploymentSummary[]>(cacheKey);
  if (cached) return cached;

  const stale = getStale<DeploymentSummary[]>(cacheKey);
  const octokit = getOctokit();

  try {
    const response = await octokit.repos.listDeployments({
      owner: getOwner(),
      repo: getRepo(),
      environment: "Preview",
      per_page: 100,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });

    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;
    const summaries: DeploymentSummary[] = response.data.map((d) => ({
      id: d.id,
      sha: d.sha,
    }));
    setCache(cacheKey, PREVIEW_REVALIDATE_TTL, summaries, { etag: newEtag });
    return summaries;
  } catch (error: any) {
    // 304 Not Modified — deployments list unchanged. Reuse stale, no rate cost.
    if (error.status === 304 && stale) {
      setCache(cacheKey, PREVIEW_REVALIDATE_TTL, stale.data, {
        etag: stale.etag,
      });
      return stale.data;
    }
    console.error("[Kody] Error fetching deployment list:", error);
    return stale?.data ?? [];
  }
}

/**
 * Fetch the latest deployment status URL for a deployment, with ETag/304
 * revalidation. Per-deployment URLs change as a deployment progresses
 * (in_progress → success), so we keep a short TTL but pay no quota when
 * unchanged.
 *
 * Returns the URL or `null` (no environment_url, e.g., still building or
 * errored). Cached `null` is also valid — the next call after TTL still
 * revalidates via ETag. We use a presence sentinel inside `data` so a
 * cache hit on a null URL is distinguishable from a cache miss.
 */
async function getDeploymentStatusUrl(
  deploymentId: number,
): Promise<string | null> {
  // Prefix with `previews:` so invalidatePRCache() catches this key.
  const cacheKey = `previews:status:${getOwner()}:${getRepo()}:${deploymentId}`;
  const cached = getCached<{ url: string | null }>(cacheKey);
  if (cached) return cached.url;

  const stale = getStale<{ url: string | null }>(cacheKey);
  const octokit = getOctokit();

  try {
    const response = await octokit.repos.listDeploymentStatuses({
      owner: getOwner(),
      repo: getRepo(),
      deployment_id: deploymentId,
      per_page: 1,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });

    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;
    const url = response.data[0]?.environment_url ?? null;
    setCache(cacheKey, PREVIEW_REVALIDATE_TTL, { url }, { etag: newEtag });
    return url;
  } catch (error: any) {
    if (error.status === 304 && stale) {
      setCache(cacheKey, PREVIEW_REVALIDATE_TTL, stale.data, {
        etag: stale.etag,
      });
      return stale.data.url;
    }
    return null;
  }
}

/**
 * Resolve the Vercel preview URL for a single commit SHA, looked up directly
 * by that commit (not via the recent-100 bulk window). This is the on-demand
 * path used when a preview pane opens: GitHub always answers "what's the
 * Preview deployment for *this* commit?" regardless of how old it is, so it
 * fixes PRs that have aged out of `getRecentPreviewDeployments`'s window.
 *
 * Returns the URL, or `null` when the deployment is still building / has no
 * `environment_url` yet. Both the per-SHA deployment lookup and the status
 * lookup are ETag-revalidated and cached, so repeated opens cost a free 304.
 */
export async function fetchPreviewForSha(sha: string): Promise<string | null> {
  if (!sha) return null;

  const cacheKey = `previews:sha:${getOwner()}:${getRepo()}:${sha}`;
  const cached = getCached<{ id: number | null }>(cacheKey);
  const stale = getStale<{ id: number | null }>(cacheKey);
  const octokit = getOctokit();

  let deploymentId: number | null;
  if (cached) {
    deploymentId = cached.id;
  } else {
    try {
      const response = await octokit.repos.listDeployments({
        owner: getOwner(),
        repo: getRepo(),
        sha,
        environment: "Preview",
        per_page: 1,
        headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
      });
      const newEtag = (response.headers as Record<string, string | undefined>)
        ?.etag;
      deploymentId = response.data[0]?.id ?? null;
      setCache(
        cacheKey,
        PREVIEW_REVALIDATE_TTL,
        { id: deploymentId },
        {
          etag: newEtag,
        },
      );
    } catch (error: any) {
      if (error.status === 304 && stale) {
        setCache(cacheKey, PREVIEW_REVALIDATE_TTL, stale.data, {
          etag: stale.etag,
        });
        deploymentId = stale.data.id;
      } else {
        console.error("[Kody] Error resolving preview for SHA:", error);
        return null;
      }
    }
  }

  if (deploymentId === null) return null;
  return getDeploymentStatusUrl(deploymentId);
}

/**
 * Fetch Vercel preview URLs for a set of PR head SHAs.
 * Strategy: 1 bulk call for the 100 most recent Preview deployments (GitHub's
 * max page size, ETag-revalidated), then 1 status call per matched deployment
 * (also ETag-revalidated and per-deployment cached).
 *
 * Older SHAs that fall outside the 100-deployment window simply don't get a
 * preview URL — accepted tradeoff to avoid the previous per-SHA fanout, which
 * cost 2 extra REST calls per missed PR on every tasks-list poll.
 *
 * No derived per-SHA-list cache: the underlying `getRecentPreviewDeployments`
 * and `getDeploymentStatusUrl` are both cheap (cache hit or free 304), so
 * recomputing the SHA → URL map on each call avoids stale results when a PR
 * pushes a new commit.
 */
export async function fetchDeploymentPreviews(
  prShas: string[],
): Promise<Map<string, string>> {
  if (prShas.length === 0) return new Map();

  const result = new Map<string, string>();
  const deployments = await getRecentPreviewDeployments();
  const shaSet = new Set(prShas);
  const matched = deployments.filter((d) => shaSet.has(d.sha));

  await Promise.all(
    matched.map(async (deployment) => {
      const url = await getDeploymentStatusUrl(deployment.id);
      if (url) result.set(deployment.sha, url);
    }),
  );

  return result;
}

// ============ PR Discovery ============

/**
 * Find PR associated with a task by branch name
 */
export async function findAssociatedPR(
  taskId: string,
): Promise<GitHubPR | null> {
  const cacheKey = `pr:${getOwner()}:${getRepo()}:${taskId}`;
  const cached = getCached<GitHubPR | null>(cacheKey);
  if (cached !== null) return cached;

  const octokit = getOctokit();

  // Try all branch prefixes
  const branchNames = BRANCH_PREFIXES.map((prefix) => `${prefix}/${taskId}`);

  for (const branchName of branchNames) {
    try {
      const { data } = await octokit.pulls.list({
        owner: getOwner(),
        repo: getRepo(),
        head: `${getOwner()}:${branchName}`,
        state: "open",
      });

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
        };
        setCache(cacheKey, CACHE_TTL.prs, pr);
        return pr;
      }
    } catch {
      // Try next prefix
    }
  }

  // Cache null as well
  setCache(cacheKey, CACHE_TTL.prs, null);
  return null;
}

/**
 * Find the PR associated with a GitHub issue number.
 * Uses the bulk open-PR list (cached) + branch name pattern matching.
 * This is the preferred method — findAssociatedPR(taskId) only works
 * for branches named exactly {prefix}/{taskId}, which fails for
 * Kody-generated branches like fix/260312-auto-781-title.
 */
export async function findAssociatedPRByIssueNumber(
  issueNumber: number,
): Promise<GitHubPR | null> {
  const cacheKey = `pr:issue:${getOwner()}:${getRepo()}:${issueNumber}`;
  const cached = getCached<GitHubPR | null>(cacheKey);
  if (cached !== null) return cached;

  // 1. Check open PRs (fast, uses cached bulk list).
  // Matching precedence MUST stay in sync with app/api/kody/tasks/route.ts —
  // if the task list shows an associatedPR via one path and this function
  // misses that path, dashboard buttons (approve-pr, close-pr, fix) 404
  // even though the badge is visible.
  const openPRs = await fetchOpenPRs();
  const issueStr = String(issueNumber);

  // Highest priority: engine-written `<!-- kody-release-pr: #N -->` marker
  // in the issue body. Persisted by release-prepare/release-deploy so the
  // link survives @kody fix overwrites of the PR body. Mirrors the bulk
  // task list's primary lookup in app/api/kody/tasks/route.ts.
  try {
    const issue = await fetchIssue(issueNumber, { ttl: CACHE_TTL.tasks });
    const marker = issue?.body?.match(
      /<!--\s*kody-release-pr:\s*#?(\d+)\s*-->/i,
    );
    if (marker) {
      const target = parseInt(marker[1]!, 10);
      const matched = openPRs.find((p) => p.number === target);
      if (matched) {
        setCache(cacheKey, CACHE_TTL.prs, matched);
        return matched;
      }
    }
  } catch {
    // Body lookup is best-effort — fall through to bulk-list signals below.
  }

  for (const pr of openPRs) {
    // Strongest signal: GraphQL "Closes/Fixes/Resolves #N" links from the PR body.
    if (pr.closingIssueNumbers?.includes(issueNumber)) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Non-closing tracker (e.g. release-prepare's `Tracking-Issue: #N` —
    // can't use a closing keyword because the orchestrator needs the
    // issue to stay open through publish + deploy after PR merge).
    if (pr.trackingIssueNumbers?.includes(issueNumber)) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Kody-auto branches put the issue number after "-auto-", so check that
    // before the generic first-digits pattern (which would capture YYMMDD).
    const autoMatch = pr.head.ref.match(/-auto-(\d+)-/);
    if (autoMatch && autoMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Traditional: {prefix}/{issueNumber}-{title}
    const branchMatch = pr.head.ref.match(/\/(\d{3,})-/);
    if (!autoMatch && branchMatch && branchMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Flat: {issueNumber}-{title} (no prefix)
    const flatMatch = pr.head.ref.match(/^(\d{3,})-/);
    if (flatMatch && flatMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Match by PR title "Closes #NNN"
    const closesMatch = pr.title.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
    if (closesMatch && closesMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
  }

  // 2. Fallback: find branch by issue number and look up PR by head ref
  const branch = await findBranchByIssueNumber(issueNumber);
  if (branch) {
    const octokit = getOctokit();
    try {
      const { data } = await octokit.pulls.list({
        owner: getOwner(),
        repo: getRepo(),
        head: `${getOwner()}:${branch}`,
        state: "open",
      });
      if (data.length > 0) {
        const pr: GitHubPR = {
          id: data[0].id,
          number: data[0].number,
          title: data[0].title,
          state: data[0].state,
          head: { ref: data[0].head.ref, sha: data[0].head.sha },
          merged_at: data[0].merged_at,
          html_url: data[0].html_url,
        };
        setCache(cacheKey, CACHE_TTL.prs, pr);
        return pr;
      }
    } catch {
      // Fall through
    }
  }

  setCache(cacheKey, CACHE_TTL.prs, null);
  return null;
}

/**
 * Fetch comments for a PR
 */
export async function fetchPRComments(prNumber: number): Promise<PRComment[]> {
  const cacheKey = `pr-comments:${getOwner()}:${getRepo()}:${prNumber}`;
  const cached = getCached<PRComment[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    // Paginate to get the full thread. GitHub returns comments ascending by
    // created_at, capped at 100 per page. Most PRs fit in one page; heavily
    // iterated ones (fix-ci/ui-review loops) need 2-3. Octokit's paginate()
    // walks all pages in one call.
    const data = await octokit.paginate(octokit.issues.listComments, {
      owner: getOwner(),
      repo: getRepo(),
      issue_number: prNumber,
      per_page: 100,
    });

    const comments: PRComment[] = data.map((comment) => ({
      id: comment.id,
      body: comment.body || "",
      created_at: comment.created_at,
      user: {
        login: comment.user?.login || "",
        avatar_url: comment.user?.avatar_url || "",
      },
    }));

    setCache(cacheKey, CACHE_TTL.tasks, comments);
    return comments;
  } catch (error) {
    console.error("[Kody] Error fetching PR comments:", error);
    return [];
  }
}

/**
 * Fetch file changes for a PR
 */
export async function fetchPRFileChanges(
  prNumber: number,
): Promise<FileChange[]> {
  const cacheKey = `pr-files:${getOwner()}:${getRepo()}:${prNumber}`;
  const cached = getCached<FileChange[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    const { data } = await octokit.pulls.listFiles({
      owner: getOwner(),
      repo: getRepo(),
      pull_number: prNumber,
      per_page: 100,
    });

    const changes: FileChange[] = data.map((file) => ({
      filename: file.filename,
      status: file.status as FileChange["status"],
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch ?? null,
      previousFilename: file.previous_filename,
    }));

    setCache(cacheKey, CACHE_TTL.tasks, changes);
    return changes;
  } catch (error) {
    console.error("[Kody] Error fetching PR files:", error);
    return [];
  }
}

/**
 * Close a PR (without merging)
 */
export async function closePR(
  prNumber: number,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.pulls.update({
    owner: getOwner(),
    repo: getRepo(),
    pull_number: prNumber,
    state: "closed",
  });

  // Invalidate PR cache only
  invalidatePRCache();
}

/**
 * Delete a branch
 */
export async function deleteBranch(
  branchName: string,
  userOctokit?: Octokit,
): Promise<void> {
  // Don't delete protected branches (single source of truth in
  // src/dashboard/lib/branches/protected-branches.ts)
  if (isProtectedBranch(branchName)) {
    console.log(`[Kody] Skipping deletion of protected branch: ${branchName}`);
    return;
  }

  const octokit = userOctokit ?? getOctokit();

  try {
    await octokit.git.deleteRef({
      owner: getOwner(),
      repo: getRepo(),
      ref: `heads/${branchName}`,
    });
    console.log(`[Kody] Deleted branch: ${branchName}`);
  } catch (error: any) {
    // Ignore if branch doesn't exist
    if (
      error.status === 422 &&
      error.message?.includes("Reference does not exist")
    ) {
      console.log(`[Kody] Branch already deleted: ${branchName}`);
      return;
    }
    throw error;
  }

  // Invalidate branch and task caches
  invalidateBranchCache();
  invalidateTaskCache();
}

/**
 * Fetch all task documents from branch by listing the task directory.
 * Discovers files dynamically instead of using a hardcoded list.
 */
export async function fetchTaskDocuments(
  taskId: string,
  branch: string,
): Promise<TaskDocument[]> {
  const octokit = getOctokit();
  const taskPath = `.tasks/${taskId}`;

  try {
    // List all files in the task directory
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: taskPath,
      ref: branch,
    });

    if (!Array.isArray(data)) return [];

    // Filter to files only (skip subdirectories), fetch content in parallel
    const files = data.filter((item: any) => item.type === "file");

    const results = await Promise.allSettled(
      files.map(async (file: any) => {
        try {
          const { data: fileData } = await octokit.repos.getContent({
            owner: getOwner(),
            repo: getRepo(),
            path: file.path,
            ref: branch,
          });

          if ("content" in fileData && fileData.content) {
            const content = Buffer.from(fileData.content, "base64").toString(
              "utf-8",
            );
            return {
              name: file.name as string,
              content,
              path: file.path as string,
            };
          }
        } catch {
          // File content couldn't be fetched
        }
        return null;
      }),
    );

    const documents: TaskDocument[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        documents.push(result.value);
      }
    }

    return documents;
  } catch {
    // Task directory doesn't exist on this branch
    return [];
  }
}

/**
 * Fetch task documents by discovering the task directory on a branch.
 * Lists .tasks/ dir, finds dirs matching YYMMDD- pattern, picks the newest,
 * then fetches known doc files from it.
 */
export async function fetchBranchDocuments(
  branch: string,
): Promise<TaskDocument[]> {
  const octokit = getOctokit();

  try {
    // 1. List .tasks/ directory on the branch
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: ".tasks",
      ref: branch,
    });

    if (!Array.isArray(data)) return [];

    // 2. Find directories matching YYMMDD- pattern (e.g., 260228-auto-74)
    const taskDirs = data
      .filter((item: any) => item.type === "dir" && /^\d{6}-/.test(item.name))
      .map((item: any) => item.name)
      .sort()
      .reverse(); // newest first by date prefix

    if (taskDirs.length === 0) return [];

    // 3. Use the newest task dir
    const taskId = taskDirs[0];

    // 4. Fetch known doc files from it
    return fetchTaskDocuments(taskId, branch);
  } catch (error: any) {
    if (error.status !== 404) {
      console.error("[Kody] Error listing branch task dirs:", error);
    }
    return [];
  }
}

// ============ Labels & Milestones ============

/**
 * Fetch all labels
 */
export async function fetchLabels(): Promise<
  Array<{ name: string; color: string }>
> {
  const cacheKey = `labels:${getOwner()}:${getRepo()}`;
  const cached = getCached<Array<{ name: string; color: string }>>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  const { data } = await octokit.issues.listLabelsForRepo({
    owner: getOwner(),
    repo: getRepo(),
    per_page: 100,
  });

  const labels = data.map((label) => ({
    name: label.name,
    color: label.color,
  }));

  setCache(cacheKey, CACHE_TTL.boards, labels);
  return labels;
}

/**
 * Fetch all milestones
 */
export async function fetchMilestones(): Promise<
  Array<{ id: number; title: string; number: number }>
> {
  const cacheKey = `milestones:${getOwner()}:${getRepo()}`;
  const cached =
    getCached<Array<{ id: number; title: string; number: number }>>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  const { data } = await octokit.issues.listMilestones({
    owner: getOwner(),
    repo: getRepo(),
    state: "open",
    per_page: 50,
  });

  const milestones = data.map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    number: milestone.number,
  }));

  setCache(cacheKey, CACHE_TTL.boards, milestones);
  return milestones;
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
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.createComment({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    body,
  });

  // Invalidate both comment caches — issue conversation and PR conversation
  // share GitHub's issue-comments endpoint, but the dashboard caches them
  // under separate keys (`comments:` for the issue panel, `pr-comments:` for
  // PreviewModal). Clear both so neither view shows stale data.
  cache.delete(`comments:${getOwner()}:${getRepo()}:${issueNumber}`);
  cache.delete(`pr-comments:${getOwner()}:${getRepo()}:${issueNumber}`);
}

/**
 * Trigger workflow dispatch
 */
export async function triggerWorkflow(
  options: {
    taskId: string;
    mode?: string;
    fromStage?: string;
    feedback?: string;
  },
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.actions.createWorkflowDispatch({
    owner: getOwner(),
    repo: getRepo(),
    workflow_id: WORKFLOW_ID,
    ref: "main",
    inputs: {
      task_id: options.taskId,
      mode: options.mode || "full",
      from_stage: options.fromStage || "",
      feedback: options.feedback || "",
    },
  });
}

/**
 * Cancel a workflow run
 */
export async function cancelWorkflowRun(
  runId: number,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.actions.cancelWorkflowRun({
    owner: getOwner(),
    repo: getRepo(),
    run_id: runId,
  });
}

// ============ Issue CRUD Operations ============

/**
 * Create a new GitHub issue
 */
export async function createIssue(
  options: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  },
  userOctokit?: Octokit,
): Promise<GitHubIssue> {
  const octokit = userOctokit ?? getOctokit();

  const { data } = await octokit.issues.create({
    owner: getOwner(),
    repo: getRepo(),
    title: options.title,
    body: options.body ?? "",
    labels: options.labels,
    assignees: options.assignees,
  });

  // Invalidate task-related caches only (not PRs, boards, etc.)
  invalidateTaskCache();

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    state: data.state as "open" | "closed",
    labels:
      data.labels?.map((l: any) => ({
        name: l.name ?? "",
        color: l.color ?? "000000",
      })) ?? [],
    milestone: data.milestone ? { title: data.milestone.title ?? "" } : null,
    assignees:
      data.assignees?.map((a: any) => ({
        login: a.login ?? "",
        avatar_url: a.avatar_url ?? "",
      })) ?? [],
    created_at: data.created_at ?? "",
    updated_at: data.updated_at ?? "",
    closed_at: data.closed_at ?? null,
    html_url: data.html_url ?? "",
  };
}

/**
 * Upload an attachment to an issue (requires GitHub Enterprise)
 */
export async function uploadIssueAttachment(
  issueNumber: number,
  file: { name: string; content: string },
  userOctokit?: Octokit,
): Promise<{ attachment_url: string; name: string }> {
  const octokit = (userOctokit ?? getOctokit()) as any;

  const buffer = Buffer.from(file.content, "base64");

  const response = await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/attachments",
    {
      owner: getOwner(),
      repo: getRepo(),
      issue_number: issueNumber,
      name: file.name,
      file: buffer,
    },
  );

  return {
    attachment_url: response.data.asset_url,
    name: response.data.name,
  };
}

/**
 * Upload a comment attachment by committing it to the connected repo under
 * `.kody/attachments/`, then handing back a markdown snippet to embed in the
 * comment body.
 *
 * Why commit-to-repo: GitHub's public REST API has no attachment-upload
 * endpoint (`uploadIssueAttachment` above is GHE-only). The web UI uploads to
 * a private `user-attachments` host the API can't reach. Committing the file
 * and embedding its URL is the only API-supported path.
 *
 * Caveat: `raw.githubusercontent.com` requires auth for private repos, so the
 * inline image preview won't render for other viewers on a private repo — the
 * link still resolves for anyone with repo access. Public repos render inline.
 */
export async function uploadCommentAttachment(
  file: { name: string; contentBase64: string },
  userOctokit?: Octokit,
): Promise<{ url: string; name: string; isImage: boolean; markdown: string }> {
  const octokit = userOctokit ?? getOctokit();
  const owner = getOwner();
  const repo = getRepo();
  const branch = await getDefaultBranch();

  // Sanitize: keep it filesystem/URL safe, cap length, always keep extension.
  const cleaned = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);
  const safeName = cleaned.replace(/^[-.]+/, "") || "file";
  const path = `.kody/attachments/${globalThis.crypto.randomUUID()}-${safeName}`;

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    message: `chore(attachments): add ${safeName}`,
    content: file.contentBase64,
  });

  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(safeName);
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const blobUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;
  const markdown = isImage
    ? `![${safeName}](${rawUrl})`
    : `[📎 ${safeName}](${blobUrl})`;

  return { url: isImage ? rawUrl : blobUrl, name: safeName, isImage, markdown };
}

/**
 * Update an issue (close, reopen, change title/body)
 */
export async function updateIssue(
  issueNumber: number,
  options: {
    title?: string;
    body?: string;
    state?: "open" | "closed";
    labels?: string[];
    assignees?: string[];
  },
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.update({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    title: options.title,
    body: options.body,
    state: options.state,
    labels: options.labels,
    assignees: options.assignees,
  });

  // Invalidate task cache
  invalidateTaskCache();
  cache.delete(`comments:${getOwner()}:${getRepo()}:${issueNumber}`);
}

/**
 * Add assignees to an issue
 */
export async function addAssignees(
  issueNumber: number,
  assignees: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.addAssignees({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    assignees,
  });

  // Invalidate task cache
  invalidateTaskCache();
}

/**
 * Remove assignees from an issue
 */
export async function removeAssignees(
  issueNumber: number,
  assignees: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.removeAssignees({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    assignees,
  });

  // Invalidate task cache
  invalidateTaskCache();
}

/**
 * Add labels to an issue
 */
export async function addLabels(
  issueNumber: number,
  labels: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.addLabels({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    labels,
  });

  // Invalidate task cache
  invalidateTaskCache();
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
  const octokit = userOctokit ?? getOctokit();
  try {
    await octokit.issues.createLabel({
      owner: getOwner(),
      repo: getRepo(),
      name,
      color: (options.color ?? "cccccc").replace(/^#/, ""),
      description: options.description,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status !== 422) throw err;
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
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.removeLabel({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    name: label,
  });

  // Invalidate task cache
  invalidateTaskCache();
}

/**
 * Fetch repository collaborators (for assignee picker).
 * Returns [] if the token lacks permission to list collaborators (e.g., private repo
 * where user is not an explicit collaborator, or insufficient scopes).
 */
export async function fetchCollaborators(): Promise<GitHubCollaborator[]> {
  const cacheKey = `collaborators:${getOwner()}:${getRepo()}`;
  const cached = getCached<GitHubCollaborator[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    const { data } = await octokit.repos.listCollaborators({
      owner: getOwner(),
      repo: getRepo(),
      per_page: 100,
    });

    const collaborators: GitHubCollaborator[] = data.map((user) => ({
      login: user.login ?? "",
      avatar_url: user.avatar_url ?? "",
    }));

    setCache(cacheKey, CACHE_TTL.boards, collaborators);
    return collaborators;
  } catch (error: unknown) {
    // Permission denied (403) or not found (404) — user is not a collaborator or token lacks scope
    const status = (error as { status?: number })?.status;
    if (status === 403 || status === 404) {
      console.warn(
        `[Kody] Cannot list collaborators (${status}), returning empty list`,
      );
      return [];
    }
    throw error;
  }
}

// ============ Utility ============

/**
 * Clear all cache (for testing or manual refresh)
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Clear specific cache categories
 */
export function clearCacheByCategory(
  category: "all" | "tasks" | "prs" | "boards" | "branches",
): void {
  switch (category) {
    case "all":
      cache.clear();
      break;
    case "tasks":
      invalidateTaskCache();
      break;
    case "prs":
      invalidatePRCache();
      break;
    case "boards":
      invalidateBoardCache();
      break;
    case "branches":
      invalidateBranchCache();
      break;
  }
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

// CI status now lives on each GitHubPR returned by `fetchOpenPRs` — no separate
// per-PR fetch. See `derivePRCi` and the OpenPRs GraphQL query above.

// ============ Discussions (for Goal threads) ============
//
// Each goal can have a backing GitHub Discussion under a "Goals" category that
// the dashboard ensures exists. Comments live as native discussion comments —
// threading, reactions, edits all come for free.
//
// All discussion ops are GraphQL only (no REST). GraphQL has no ETag/304 path,
// so the rate-limit story matches `fetchOpenPRs`: TTL cache + in-flight dedup
// + stale-on-error refresh.

export interface GoalDiscussionComment {
  id: string;
  databaseId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  author: { login: string; avatarUrl?: string } | null;
}

export interface GoalDiscussionRef {
  /** GraphQL node ID (used for comment mutations). */
  id: string;
  /** Numeric discussion number, for the github.com URL. */
  number: number;
  url: string;
  commentsCount: number;
}

interface RepoDiscussionMeta {
  enabled: boolean;
  /**
   * GraphQL node ID for the discussion category goal threads will be filed
   * under. Picks (in order of preference): a category named "Goals" if the
   * user opted in by creating one, "General" (the default catch-all created
   * automatically when Discussions are enabled), then the first non-
   * announcements category, then any. Null only if no categories exist
   * (Discussions disabled, or all categories deleted manually).
   */
  categoryId: string | null;
  /** Display name of the chosen category, for diagnostics. */
  categoryName: string | null;
}

const DISCUSSIONS_META_TTL = 10 * 60_000; // 10min — flips rarely, webhook invalidates
const DISCUSSION_COMMENTS_TTL = 60_000; // 1min — UI-driven re-reads

/**
 * Names tried in order when picking the discussion category to file goal
 * threads under. The first match wins. The dashboard never *creates* a
 * category — GitHub doesn't expose category creation in any public API —
 * so we rely on the defaults that get seeded when Discussions is enabled.
 *
 * Power users can opt into a dedicated bucket by creating one named "Goals"
 * (or any preferred-list name) on github.com.
 */
const PREFERRED_CATEGORY_NAMES = ["Goals", "General", "Ideas", "Show and tell"];

const inflightDiscussionsMeta = new Map<string, Promise<RepoDiscussionMeta>>();
const inflightDiscussionComments = new Map<
  string,
  Promise<GoalDiscussionComment[]>
>();

/**
 * Pick the best discussion category to file goal threads under, given the
 * repo's actual category list. Walks the preferred-name list first, then
 * falls back to the first non-announcements category, then any.
 */
function pickCategory(
  cats: { id: string; name: string }[],
): { id: string; name: string } | null {
  if (cats.length === 0) return null;
  for (const preferred of PREFERRED_CATEGORY_NAMES) {
    const hit = cats.find(
      (c) => c.name.toLowerCase() === preferred.toLowerCase(),
    );
    if (hit) return hit;
  }
  const nonAnnouncements = cats.find(
    (c) => !c.name.toLowerCase().includes("announce"),
  );
  return nonAnnouncements ?? cats[0];
}

/**
 * Wipe discussion caches. Called from the webhook receiver on `discussion`,
 * `discussion_comment`, and `repository` events. Also clears the messaging
 * channels cache, since channels are Discussions in the same category and a
 * new/edited discussion changes the channel list and ordering.
 */
export function invalidateDiscussionCache(): void {
  invalidateCache("discussions-meta:");
  invalidateCache("discussion-comments:");
  invalidateCache("message-channels:");
}

/**
 * Read the repo's discussion capability metadata: whether Discussions are
 * enabled at all, and (if so) the GraphQL node ID of the "Goals" category.
 *
 * Caches the result for 10min in-process. Cross-instance cache is not needed
 * because the value flips at most once per repo lifecycle.
 */
export async function fetchRepoDiscussionMeta(): Promise<RepoDiscussionMeta> {
  const cacheKey = `discussions-meta:${getOwner()}:${getRepo()}`;
  const cached = getCached<RepoDiscussionMeta>(cacheKey);
  if (cached) return cached;

  const existing = inflightDiscussionsMeta.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<RepoDiscussionMeta>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query RepoDiscussionMeta($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        hasDiscussionsEnabled
        discussionCategories(first: 25) {
          nodes { id name }
        }
      }
    }
  `;

  const promise = (async () => {
    try {
      const data = await octokit.graphql<{
        repository: {
          hasDiscussionsEnabled: boolean;
          discussionCategories: {
            nodes: { id: string; name: string }[];
          } | null;
        };
      }>(query, { owner: getOwner(), repo: getRepo() });

      const enabled = !!data.repository.hasDiscussionsEnabled;
      const cats = data.repository.discussionCategories?.nodes ?? [];
      const chosen = pickCategory(cats);

      const meta: RepoDiscussionMeta = {
        enabled,
        categoryId: enabled && chosen ? chosen.id : null,
        categoryName: enabled && chosen ? chosen.name : null,
      };
      setCache(cacheKey, DISCUSSIONS_META_TTL, meta);
      return meta;
    } catch (err) {
      if (stale) {
        // Refresh TTL on stale to dampen GraphQL throttling under load.
        setCache(cacheKey, Math.min(DISCUSSIONS_META_TTL, 60_000), stale.data);
        return stale.data;
      }
      throw err;
    } finally {
      inflightDiscussionsMeta.delete(cacheKey);
    }
  })();

  inflightDiscussionsMeta.set(cacheKey, promise);
  return promise;
}

/**
 * Outcome of a `enableRepoDiscussions` call. The caller surfaces these
 * states to the UI to drive the disabled-badge copy.
 */
export type EnableDiscussionsOutcome =
  | { ok: true; alreadyEnabled: boolean }
  | {
      ok: false;
      reason: "forbidden" | "unknown";
      status?: number;
      message?: string;
    };

/**
 * Idempotently turn on Discussions for the current repo. Uses the user PAT
 * (must be repo admin) — never the shared polling token, since this is a
 * permission-sensitive write that should be attributed to the human.
 *
 * Returns `{ ok: true, alreadyEnabled: true }` as a fast path when the
 * cached meta already says it's on (no API call). On 403 we report
 * `forbidden` so the UI can prompt the user to ask an admin.
 *
 * Cache: invalidates the discussions-meta cache on success so the next
 * read sees the new state without waiting for the 10-minute TTL.
 */
export async function enableRepoDiscussions(
  userOctokit: Octokit,
): Promise<EnableDiscussionsOutcome> {
  // Cheap pre-check: if cached meta already says enabled, skip the PATCH.
  const cached = getCached<RepoDiscussionMeta>(
    `discussions-meta:${getOwner()}:${getRepo()}`,
  );
  if (cached?.enabled) {
    return { ok: true, alreadyEnabled: true };
  }

  try {
    await userOctokit.request("PATCH /repos/{owner}/{repo}", {
      owner: getOwner(),
      repo: getRepo(),
      has_discussions: true,
    });
    invalidateDiscussionCache();
    return { ok: true, alreadyEnabled: false };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 403 || e.status === 401 || e.status === 404) {
      // 404 from PATCH typically means "you don't have admin rights to see
      // this endpoint on this repo" — treat as forbidden for UX purposes.
      return {
        ok: false,
        reason: "forbidden",
        status: e.status,
        message: e.message,
      };
    }
    return {
      ok: false,
      reason: "unknown",
      status: e.status,
      message: e.message,
    };
  }
}

/**
 * Look up the GraphQL repository ID. Cached forever per (owner,repo) — IDs
 * never change.
 */
const repoIdCache = new Map<string, string>();
export async function fetchRepositoryId(): Promise<string> {
  const key = `${getOwner()}/${getRepo()}`;
  const hit = repoIdCache.get(key);
  if (hit) return hit;
  const octokit = getOctokit();
  const data = await octokit.graphql<{ repository: { id: string } }>(
    `query RepoId($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { id } }`,
    { owner: getOwner(), repo: getRepo() },
  );
  repoIdCache.set(key, data.repository.id);
  return data.repository.id;
}

/**
 * Create a discussion under the goals category and return its IDs.
 *
 * Uses `userOctokit` so the discussion is attributed to the human who
 * triggered the create — never the shared polling token.
 */
export async function createGoalDiscussion(
  args: {
    title: string;
    body: string;
    categoryId: string;
  },
  userOctokit?: Octokit,
): Promise<GoalDiscussionRef> {
  const octokit = userOctokit ?? getOctokit();
  const repoId = await fetchRepositoryId();

  const data = await octokit.graphql<{
    createDiscussion: {
      discussion: {
        id: string;
        number: number;
        url: string;
        comments: { totalCount: number };
      };
    };
  }>(
    `mutation CreateGoalDiscussion(
       $repoId: ID!,
       $categoryId: ID!,
       $title: String!,
       $body: String!
     ) {
       createDiscussion(input: {
         repositoryId: $repoId,
         categoryId: $categoryId,
         title: $title,
         body: $body
       }) {
         discussion {
           id
           number
           url
           comments(first: 0) { totalCount }
         }
       }
     }`,
    {
      repoId,
      categoryId: args.categoryId,
      title: args.title,
      body: args.body,
    },
  );
  const d = data.createDiscussion.discussion;
  invalidateDiscussionCache();
  return {
    id: d.id,
    number: d.number,
    url: d.url,
    commentsCount: d.comments.totalCount,
  };
}

/**
 * Update the discussion title/body — used when the goal name or description
 * changes.
 */
export async function updateGoalDiscussion(
  args: { discussionId: string; title?: string; body?: string },
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();
  const updates: Record<string, unknown> = { discussionId: args.discussionId };
  if (typeof args.title === "string") updates.title = args.title;
  if (typeof args.body === "string") updates.body = args.body;
  if (Object.keys(updates).length === 1) return; // nothing to change

  await octokit.graphql(
    `mutation UpdateGoalDiscussion($discussionId: ID!, $title: String, $body: String) {
       updateDiscussion(input: { discussionId: $discussionId, title: $title, body: $body }) {
         discussion { id }
       }
     }`,
    updates,
  );
  invalidateDiscussionCache();
}

/**
 * Close (lock) a discussion — used when a goal is removed. We never delete
 * to preserve history.
 */
export async function closeGoalDiscussion(
  discussionId: string,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();
  try {
    await octokit.graphql(
      `mutation CloseGoalDiscussion($discussionId: ID!) {
         closeDiscussion(input: { discussionId: $discussionId, reason: RESOLVED }) {
           discussion { id }
         }
       }`,
      { discussionId },
    );
  } catch {
    // Older repos / permission limits — non-fatal.
  }
  invalidateDiscussionCache();
}

/**
 * Fetch comments on a goal's discussion. Cached + in-flight-deduped + stale-
 * on-error, mirroring the `fetchOpenPRs` pattern (GraphQL has no ETag).
 */
export async function fetchGoalDiscussionComments(
  discussionNumber: number,
): Promise<GoalDiscussionComment[]> {
  const cacheKey = `discussion-comments:${getOwner()}:${getRepo()}:${discussionNumber}`;
  const cached = getCached<GoalDiscussionComment[]>(cacheKey);
  if (cached) return cached;

  const existing = inflightDiscussionComments.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<GoalDiscussionComment[]>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query DiscussionComments($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              createdAt
              updatedAt
              url
              author { login avatarUrl }
            }
          }
        }
      }
    }
  `;

  const promise = (async () => {
    try {
      const data = await octokit.graphql<{
        repository: {
          discussion: {
            comments: {
              nodes: {
                id: string;
                databaseId: number;
                body: string;
                createdAt: string;
                updatedAt: string;
                url: string;
                author: { login: string; avatarUrl?: string } | null;
              }[];
            };
          } | null;
        };
      }>(query, {
        owner: getOwner(),
        repo: getRepo(),
        number: discussionNumber,
      });

      const nodes = data.repository.discussion?.comments.nodes ?? [];
      const comments: GoalDiscussionComment[] = nodes.map((n) => ({
        id: n.id,
        databaseId: n.databaseId,
        body: n.body ?? "",
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        url: n.url,
        author: n.author
          ? { login: n.author.login, avatarUrl: n.author.avatarUrl }
          : null,
      }));
      setCache(cacheKey, DISCUSSION_COMMENTS_TTL, comments);
      return comments;
    } catch (err) {
      if (stale) {
        setCache(
          cacheKey,
          Math.min(DISCUSSION_COMMENTS_TTL, 30_000),
          stale.data,
        );
        return stale.data;
      }
      throw err;
    } finally {
      inflightDiscussionComments.delete(cacheKey);
    }
  })();

  inflightDiscussionComments.set(cacheKey, promise);
  return promise;
}

export interface GoalDiscussionThread {
  title: string;
  body: string;
  state: "open" | "closed";
  htmlUrl: string;
  createdAt: string;
  comments: GoalDiscussionComment[];
}

/**
 * Fetch a discussion's title + body + comments in one GraphQL call.
 *
 * Powers the inbox's inline thread viewer for "goal" mentions (goals are
 * GitHub Discussions). On-demand only (one click) — not polled — so it
 * doesn't add to the GraphQL polling budget, but it still caches with the
 * same TTL as `fetchGoalDiscussionComments` to coalesce repeat opens.
 */
export async function fetchGoalDiscussionThread(
  discussionNumber: number,
): Promise<GoalDiscussionThread | null> {
  const cacheKey = `discussion-thread:${getOwner()}:${getRepo()}:${discussionNumber}`;
  const cached = getCached<GoalDiscussionThread>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();
  const query = `
    query DiscussionThread($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          title
          body
          url
          createdAt
          closed
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              createdAt
              updatedAt
              url
              author { login avatarUrl }
            }
          }
        }
      }
    }
  `;

  const data = await octokit.graphql<{
    repository: {
      discussion: {
        title: string;
        body: string;
        url: string;
        createdAt: string;
        closed: boolean;
        comments: {
          nodes: {
            id: string;
            databaseId: number;
            body: string;
            createdAt: string;
            updatedAt: string;
            url: string;
            author: { login: string; avatarUrl?: string } | null;
          }[];
        };
      } | null;
    };
  }>(query, {
    owner: getOwner(),
    repo: getRepo(),
    number: discussionNumber,
  });

  const d = data.repository.discussion;
  if (!d) return null;

  const thread: GoalDiscussionThread = {
    title: d.title,
    body: d.body ?? "",
    state: d.closed ? "closed" : "open",
    htmlUrl: d.url,
    createdAt: d.createdAt,
    comments: d.comments.nodes.map((n) => ({
      id: n.id,
      databaseId: n.databaseId,
      body: n.body ?? "",
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      url: n.url,
      author: n.author
        ? { login: n.author.login, avatarUrl: n.author.avatarUrl }
        : null,
    })),
  };

  setCache(cacheKey, DISCUSSION_COMMENTS_TTL, thread);
  return thread;
}

/**
 * Post a comment on a goal's discussion. Always uses `userOctokit` so the
 * comment is attributed to the actual user — never the shared polling token.
 */
export async function postGoalDiscussionComment(
  args: { discussionId: string; body: string; discussionNumber?: number },
  userOctokit?: Octokit,
): Promise<GoalDiscussionComment> {
  const octokit = userOctokit ?? getOctokit();
  const data = await octokit.graphql<{
    addDiscussionComment: {
      comment: {
        id: string;
        databaseId: number;
        body: string;
        createdAt: string;
        updatedAt: string;
        url: string;
        author: { login: string; avatarUrl?: string } | null;
      };
    };
  }>(
    `mutation PostGoalDiscussionComment($discussionId: ID!, $body: String!) {
       addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
         comment {
           id
           databaseId
           body
           createdAt
           updatedAt
           url
           author { login avatarUrl }
         }
       }
     }`,
    { discussionId: args.discussionId, body: args.body },
  );
  if (typeof args.discussionNumber === "number") {
    invalidateCache(
      `discussion-comments:${getOwner()}:${getRepo()}:${args.discussionNumber}`,
    );
  } else {
    invalidateDiscussionCache();
  }
  const c = data.addDiscussionComment.comment;
  return {
    id: c.id,
    databaseId: c.databaseId,
    body: c.body ?? "",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    url: c.url,
    author: c.author
      ? { login: c.author.login, avatarUrl: c.author.avatarUrl }
      : null,
  };
}

// ============ Messaging channels (team chat over Discussions) ============
//
// A messaging "channel" is just a GitHub Discussion in the same category
// goals use, distinguished by a `#`-prefixed title (e.g. `#general`). GitHub
// exposes no API to create discussion *categories*, so we don't try — the
// title prefix cleanly separates channels from goal threads (which are
// titled `Goal: …`) even when both share the "General" category.
//
// Reuses the goal-discussion comment ops (`fetchGoalDiscussionComments` /
// `postGoalDiscussionComment`) for thread reads/writes — they're generic
// over a discussion number/id, and posting already invalidates the right
// per-discussion comment cache, so the messaging feed stays fresh without
// extra plumbing.

/** Prefix marking a Discussion as a messaging channel. */
export const MESSAGE_CHANNEL_PREFIX = "#";

export interface MessageChannel {
  /** Numeric discussion number — the channel's stable id in the URL. */
  number: number;
  /** GraphQL node ID, needed to post comments. */
  id: string;
  /** Channel name without the leading `#`. */
  name: string;
  url: string;
  commentsCount: number;
  /** Discussion `updatedAt` — used to sort most-active channels first. */
  updatedAt: string;
  /** Login of whoever opened the channel. */
  author: { login: string; avatarUrl?: string } | null;
}

const MESSAGE_CHANNELS_TTL = 30_000; // 30s — list is UI-polled
const inflightMessageChannels = new Map<string, Promise<MessageChannel[]>>();

/** Normalize a user-supplied channel name into a `#slug` discussion title. */
export function channelTitleFromName(rawName: string): string {
  const slug = rawName
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${MESSAGE_CHANNEL_PREFIX}${slug || "channel"}`;
}

/**
 * List messaging channels: Discussions in the resolved category whose title
 * starts with `#`. Cached + in-flight-deduped + stale-on-error, matching the
 * `fetchOpenPRs` GraphQL rate-limit pattern (no ETag on GraphQL).
 */
export async function fetchMessageChannels(): Promise<MessageChannel[]> {
  const cacheKey = `message-channels:${getOwner()}:${getRepo()}`;
  const cached = getCached<MessageChannel[]>(cacheKey);
  if (cached) return cached;

  const existing = inflightMessageChannels.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<MessageChannel[]>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query MessageChannels($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        discussions(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            id
            number
            title
            url
            updatedAt
            comments(first: 0) { totalCount }
            author { login avatarUrl }
          }
        }
      }
    }
  `;

  const promise = (async () => {
    try {
      const data = await octokit.graphql<{
        repository: {
          discussions: {
            nodes: {
              id: string;
              number: number;
              title: string;
              url: string;
              updatedAt: string;
              comments: { totalCount: number };
              author: { login: string; avatarUrl?: string } | null;
            }[];
          };
        };
      }>(query, { owner: getOwner(), repo: getRepo() });

      const channels: MessageChannel[] = data.repository.discussions.nodes
        .filter((n) => n.title.startsWith(MESSAGE_CHANNEL_PREFIX))
        .map((n) => ({
          number: n.number,
          id: n.id,
          name: n.title.slice(MESSAGE_CHANNEL_PREFIX.length) || n.title,
          url: n.url,
          commentsCount: n.comments.totalCount,
          updatedAt: n.updatedAt,
          author: n.author
            ? { login: n.author.login, avatarUrl: n.author.avatarUrl }
            : null,
        }));
      setCache(cacheKey, MESSAGE_CHANNELS_TTL, channels);
      return channels;
    } catch (err) {
      if (stale) {
        setCache(cacheKey, Math.min(MESSAGE_CHANNELS_TTL, 30_000), stale.data);
        return stale.data;
      }
      throw err;
    } finally {
      inflightMessageChannels.delete(cacheKey);
    }
  })();

  inflightMessageChannels.set(cacheKey, promise);
  return promise;
}

/**
 * Create a new messaging channel (a `#`-titled Discussion in the goals
 * category). Attributed to the human via `userOctokit`.
 */
export async function createMessageChannel(
  args: { name: string; categoryId: string; topic?: string },
  userOctokit?: Octokit,
): Promise<MessageChannel> {
  const title = channelTitleFromName(args.name);
  const created = await createGoalDiscussion(
    {
      title,
      body:
        args.topic?.trim() ||
        `Team channel **${title}** — messages here fan out to @mentioned teammates via push, Slack, and the inbox.`,
      categoryId: args.categoryId,
    },
    userOctokit,
  );
  return {
    number: created.number,
    id: created.id,
    name: title.slice(MESSAGE_CHANNEL_PREFIX.length),
    url: created.url,
    commentsCount: created.commentsCount,
    updatedAt: new Date().toISOString(),
    author: null,
  };
}

/**
 * Permanently delete a channel (its backing Discussion). Unlike goal
 * threads — which we only *close* to preserve history — a channel is
 * disposable team chat, so the user can remove it outright. Attributed
 * to the human via `userOctokit` (needs maintain/admin on the repo).
 */
export async function deleteMessageChannel(
  discussionId: string,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();
  await octokit.graphql(
    `mutation DeleteMessageChannel($id: ID!) {
       deleteDiscussion(input: { id: $id }) {
         discussion { id }
       }
     }`,
    { id: discussionId },
  );
  invalidateDiscussionCache();
}
