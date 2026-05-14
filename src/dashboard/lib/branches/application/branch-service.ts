/**
 * @fileType module
 * @domain branches
 * @pattern application-service
 * @ai-summary Orchestration layer. Owns the policy of how branches are
 *   created, synced, and torn down. Talks to `BranchRepo` for GitHub
 *   side-effects; never touches Octokit directly.
 *
 *   Replaces the inline branch logic previously embedded in
 *   `app/api/kody/chat/tools/vibe-tools.ts`. Callers are now routes/tools
 *   that compose `BranchService` calls — the god-function is gone.
 */
import { isProtectedBranch } from '../domain/protected-branches'
import { buildBranchName, slugifyTitle } from '../domain/branch-name'
import { isKodyOwnedBranch } from '../domain/branch-ownership'
import type { LockPort } from '../domain/lock-port'
import { ForeignBranchError, LockTakenError } from '../errors'
import type { BranchRepo, MergeResult } from '../infra/github-branch-repo'

/** Default lease TTL for `getOrCreate` — 5 minutes covers branch
 *  create + sync + PR creation comfortably, and any crashed holder
 *  gets unblocked within that window. */
const GET_OR_CREATE_LOCK_TTL_MS = 5 * 60_000

export interface GetOrCreateInput {
  issueNumber: number
  /** Optional caller-supplied slug. If omitted, derived from issue title. */
  slug?: string
  /** Optional base branch override. Defaults to the repo's default branch. */
  baseRef?: string
}

export interface GetOrCreateResult {
  branchName: string
  sha: string
  existed: boolean
  baseRef: string
  /** Issue title at the time of creation — useful for downstream PR titles. */
  issueTitle: string
}

export type SyncResult =
  | { status: 'identical' | 'ahead' | 'fast-forwarded' | 'merged'; headSha: string }
  | { status: 'conflict'; message: string }

export interface PRResult {
  number: number
  url: string
  /** True when a new PR was opened; false when an existing one was reused. */
  created: boolean
}

export class BranchService {
  constructor(private readonly repo: BranchRepo) {}

  /**
   * Get-or-create a Kody work branch for an issue. Idempotent per
   * (issueNumber, slug) pair. The branch is seeded with a single empty
   * "marker" commit so future iterations can verify ownership.
   *
   * Throws if the issue number actually points to a pull request.
   */
  async getOrCreate(input: GetOrCreateInput): Promise<GetOrCreateResult> {
    const issue = await this.repo.getIssue(input.issueNumber)
    if (issue.isPullRequest) {
      throw new Error(
        `#${input.issueNumber} is a pull request, not an issue.`,
      )
    }

    const slug = slugifyTitle(input.slug ?? issue.title)
    const branchName = buildBranchName(input.issueNumber, slug)
    const baseRef = input.baseRef ?? (await this.repo.getDefaultBranch())

    const result = await this.repo.createBranchWithMarker({
      branchName,
      baseRef,
      markerMessage: `vibe: start session for #${input.issueNumber}`,
    })

    // Foreign-branch guard: if the branch already existed, verify it
    // was actually created by Kody for THIS issue before reusing it.
    // Without this, a pre-existing human branch with the same name
    // (or a Kody branch from a different issue that happens to slug
    // to the same value) would be silently reused and clobbered.
    if (result.existed) {
      const messages = await this.repo.listBranchCommitMessages({
        branchName,
        baseRef,
      })
      if (!isKodyOwnedBranch(messages, input.issueNumber)) {
        throw new ForeignBranchError(branchName, input.issueNumber)
      }
    }

    return {
      branchName,
      sha: result.sha,
      existed: result.existed,
      baseRef,
      issueTitle: issue.title,
    }
  }

  /**
   * Bring a (possibly stale) branch back in sync with its base.
   *
   *  - `identical` / `ahead` → no-op
   *  - `behind`              → fast-forward
   *  - `diverged`            → merge base into branch (preserves work)
   *  - conflict              → returned as a `conflict` status; caller
   *                             surfaces a user-facing message instead of
   *                             throwing
   *
   * Other GitHub errors propagate.
   */
  async syncWithBase(branchName: string, baseRef?: string): Promise<SyncResult> {
    const base = baseRef ?? (await this.repo.getDefaultBranch())
    const cmp = await this.repo.compareCommits({ base: branchName, head: base })

    if (cmp.status === 'identical' || cmp.status === 'ahead') {
      return { status: cmp.status === 'identical' ? 'identical' : 'ahead', headSha: cmp.mergeBaseSha }
    }

    if (cmp.status === 'behind') {
      const targetSha = await this.repo.getRefSha(base)
      await this.repo.fastForward({ branchName, targetSha })
      return { status: 'fast-forwarded', headSha: targetSha }
    }

    // diverged → merge base into branch
    const merge: MergeResult = await this.repo.merge({
      base: branchName,
      head: base,
      commitMessage: `Merge ${base} into ${branchName}`,
    })
    if (merge.kind === 'conflict') {
      return { status: 'conflict', message: merge.message }
    }
    return { status: 'merged', headSha: merge.sha }
  }

  /**
   * Idempotent: returns the existing open PR for `branchName` if one
   * already exists, otherwise opens a draft PR.
   */
  async findOrCreateDraftPR(input: {
    branchName: string
    baseRef: string
    title: string
    body: string
  }): Promise<PRResult> {
    const existing = await this.repo.listOpenPRsForBranch(input.branchName)
    if (existing.length > 0) {
      return {
        number: existing[0].number,
        url: existing[0].htmlUrl,
        created: false,
      }
    }
    const pr = await this.repo.createDraftPR({
      head: input.branchName,
      base: input.baseRef,
      title: input.title,
      body: input.body,
    })
    return { number: pr.number, url: pr.htmlUrl, created: true }
  }

  /**
   * Delete a branch, refusing protected names. Idempotent: deletion of a
   * branch that no longer exists is a no-op.
   */
  async delete(branchName: string): Promise<{ deleted: boolean; reason?: string }> {
    if (isProtectedBranch(branchName)) {
      return { deleted: false, reason: 'protected' }
    }
    try {
      await this.repo.deleteBranch(branchName)
      return { deleted: true }
    } catch (err) {
      const e = err as { status?: number; message?: string }
      if (e.status === 422) {
        return { deleted: false, reason: 'not-found' }
      }
      throw err
    }
  }
}
