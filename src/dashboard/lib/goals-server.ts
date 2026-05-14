/**
 * @fileType utility
 * @domain kody
 * @pattern goals-cas
 * @ai-summary Server-only goals-manifest helpers. Wraps the read → mutate →
 *   write cycle in (a) an in-process per-repo mutex and (b) a verify-after-write
 *   retry loop so concurrent goal writes can't silently overwrite each other.
 *
 * Why this exists:
 *   Goals live in a single GitHub issue body. The previous routes did
 *     read (15s cached) → mutate locally → updateIssue
 *   with no compare-and-swap. Two writes inside the cache window — common
 *   when the user creates / renames / drags goals quickly — could read the
 *   same stale snapshot and the second write would overwrite the first
 *   write's additions. GitHub's issue PATCH endpoint doesn't support
 *   `If-Match`, so we serialize within the instance and verify after write.
 *
 * Limits:
 *   The mutex is per-Vercel-instance. Cross-instance contention is rare
 *   for a single user but is mitigated by the verify-after-write check
 *   (which re-reads with `noCache: true` and retries if the body doesn't
 *   match what we wrote). For a stronger guarantee we'd need a real
 *   distributed lock or move the manifest off a GitHub issue body.
 */
import type { Octokit } from '@octokit/rest'
import {
  fetchIssues,
  fetchIssue,
  createIssue,
  updateIssue,
  invalidateIssueCache,
  getOwner,
  getRepo,
} from './github-client'
import {
  EMPTY_MANIFEST,
  GOALS_MANIFEST_LABEL,
  MANIFEST_ISSUE_TITLE,
  parseManifestBody,
  serializeManifestBody,
  type GoalsManifest,
} from './goals'

// ─────────────────────────────────────────────────────────────────────────────
// Per-repo mutex
// ─────────────────────────────────────────────────────────────────────────────

const locks = new Map<string, Promise<unknown>>()

async function withRepoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  // Chain ourselves onto the tail so the next caller waits on us. We don't
  // care about the previous result — only that it has settled.
  const run = previous.then(() => fn(), () => fn())
  locks.set(key, run)
  try {
    return await run
  } finally {
    if (locks.get(key) === run) locks.delete(key)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read / write primitives (cache-bypassing — write paths only)
// ─────────────────────────────────────────────────────────────────────────────

interface ManifestRef {
  number: number | null
  manifest: GoalsManifest
}

async function readManifestFresh(): Promise<ManifestRef> {
  // Bypass the 15s cache: this is the *write* path's read, not the polled
  // GET path. The GET handler still uses the cache + ETag/304 for budget.
  const issues = await fetchIssues({
    state: 'open',
    labels: GOALS_MANIFEST_LABEL,
    perPage: 5,
    noCache: true,
  })
  if (!issues.length) {
    return { number: null, manifest: { ...EMPTY_MANIFEST, goals: [] } }
  }
  const first = [...issues].sort((a, b) => a.number - b.number)[0]
  const full = await fetchIssue(first.number, { noCache: true })
  return { number: first.number, manifest: parseManifestBody(full?.body ?? '') }
}

async function writeManifest(
  next: GoalsManifest,
  existingNumber: number | null,
  userOctokit?: Octokit,
): Promise<number> {
  const body = serializeManifestBody(next)
  if (existingNumber !== null) {
    await updateIssue(existingNumber, { body }, userOctokit)
    return existingNumber
  }
  const created = await createIssue(
    {
      title: MANIFEST_ISSUE_TITLE,
      body,
      labels: [GOALS_MANIFEST_LABEL],
    },
    userOctokit,
  )
  return created.number
}

// ─────────────────────────────────────────────────────────────────────────────
// CAS verify
// ─────────────────────────────────────────────────────────────────────────────

function manifestsEqual(a: GoalsManifest, b: GoalsManifest): boolean {
  if (a.goals.length !== b.goals.length) return false
  for (let i = 0; i < a.goals.length; i++) {
    const ga = a.goals[i]
    const gb = b.goals[i]
    if (
      ga.id !== gb.id ||
      ga.name !== gb.name ||
      (ga.description ?? null) !== (gb.description ?? null) ||
      (ga.dueDate ?? null) !== (gb.dueDate ?? null) ||
      ga.createdAt !== gb.createdAt ||
      (ga.updatedAt ?? null) !== (gb.updatedAt ?? null) ||
      (ga.discussionId ?? null) !== (gb.discussionId ?? null) ||
      (ga.discussionNumber ?? null) !== (gb.discussionNumber ?? null) ||
      (ga.assignee ?? null) !== (gb.assignee ?? null)
    ) {
      return false
    }
  }
  return true
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface MutateOptions {
  userOctokit?: Octokit
  /** Max attempts on cross-instance write conflict. Default 3. */
  maxAttempts?: number
}

export interface MutationOutcome<T> {
  /** The mutator's chosen response value (the new goal, the updated goal, etc.). */
  result: T
  /** The manifest we just wrote. */
  manifest: GoalsManifest
  /** The manifest issue number we wrote to (created or existing). */
  issueNumber: number
}

export type MutatorReturn<T> =
  | { next: GoalsManifest; result: T }
  | { kind: 'noop'; result: T }

export type Mutator<T> = (
  current: GoalsManifest,
) => MutatorReturn<T> | Promise<MutatorReturn<T>>

/**
 * Read the manifest fresh, run the mutator to compute the next state, write
 * it back, then verify the write took. Serialized per-repo via in-process
 * mutex; on cross-instance conflict (verify mismatch), retries up to
 * `maxAttempts` from a fresh read.
 *
 * The mutator may return `{ kind: 'noop', result }` to abort the write while
 * still returning a value (e.g. when the goal-id wasn't found and the route
 * wants to respond 404).
 */
export async function mutateGoalsManifest<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T> | { kind: 'noop'; result: T }> {
  const lockKey = `${getOwner()}/${getRepo()}`
  const maxAttempts = options.maxAttempts ?? 3

  return withRepoLock(lockKey, async () => {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ref = await readManifestFresh()
      const mutation = await mutator(ref.manifest)

      if ('kind' in mutation && mutation.kind === 'noop') {
        return { kind: 'noop' as const, result: mutation.result }
      }

      const written = mutation as { next: GoalsManifest; result: T }
      const issueNumber = await writeManifest(written.next, ref.number, options.userOctokit)
      invalidateIssueCache(issueNumber)

      // Verify: re-read with noCache; if the body doesn't match what we
      // wrote, a concurrent writer landed after us and our changes were
      // overwritten — retry from a fresh read.
      const verify = await fetchIssue(issueNumber, { noCache: true })
      const verifyManifest = parseManifestBody(verify?.body ?? '')

      if (manifestsEqual(verifyManifest, written.next)) {
        return {
          result: written.result,
          manifest: written.next,
          issueNumber,
        }
      }

      lastError = new Error(
        `goals manifest write conflict on issue #${issueNumber} (attempt ${attempt}/${maxAttempts})`,
      )
      // Small jittered backoff before re-reading + re-mutating.
      await sleep(50 * attempt + Math.floor(Math.random() * 50))
    }

    throw (
      lastError ??
      new Error(`goals manifest write conflict: failed after ${maxAttempts} attempts`)
    )
  })
}

/**
 * Read-only manifest accessor for write-path routes that need the issue
 * number (e.g. to invalidate cache after a related side-effect). Bypasses
 * the cache. The polled GET path should keep using its own cached read.
 */
export async function readGoalsManifestFresh(): Promise<ManifestRef> {
  return readManifestFresh()
}
