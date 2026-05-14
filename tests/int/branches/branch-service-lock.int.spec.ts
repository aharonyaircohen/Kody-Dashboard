import { beforeEach, describe, expect, it } from 'vitest'
import { BranchService } from '@dashboard/lib/branches/application/branch-service'
import { LockTakenError } from '@dashboard/lib/branches/errors'
import type { Lease, LockPort } from '@dashboard/lib/branches/domain/lock-port'
import type {
  BranchRepo,
  CompareStatus,
  CreateBranchResult,
  IssueSummary,
  MergeResult,
  OpenPR,
} from '@dashboard/lib/branches/infra/github-branch-repo'

/** Trivial pass-through repo — these tests are about the lock, not branch logic. */
class StubRepo implements BranchRepo {
  branches = new Map<string, { sha: string; messages: string[] }>([
    ['main', { sha: 'sha-main', messages: [] }],
  ])
  async getDefaultBranch() {
    return 'main'
  }
  async getRefSha(ref: string) {
    return this.branches.get(ref)?.sha ?? 'sha-x'
  }
  async createBranchWithMarker(input: {
    branchName: string
    baseRef: string
    markerMessage: string
  }): Promise<CreateBranchResult> {
    if (this.branches.has(input.branchName)) {
      return { sha: this.branches.get(input.branchName)!.sha, existed: true }
    }
    const sha = `sha-${input.branchName}`
    this.branches.set(input.branchName, {
      sha,
      messages: [input.markerMessage],
    })
    return { sha, existed: false }
  }
  async compareCommits(): Promise<{ status: CompareStatus; mergeBaseSha: string }> {
    return { status: 'identical', mergeBaseSha: 'sha-main' }
  }
  async listBranchCommitMessages(input: { branchName: string }): Promise<string[]> {
    return this.branches.get(input.branchName)?.messages ?? []
  }
  async fastForward() {}
  async merge(): Promise<MergeResult> {
    return { kind: 'merged', sha: 'sha-merged' }
  }
  async listOpenPRsForBranch(): Promise<OpenPR[]> {
    return []
  }
  async createDraftPR(): Promise<OpenPR> {
    return { number: 1, htmlUrl: 'http://x' }
  }
  async deleteBranch() {}
  async getIssue(n: number): Promise<IssueSummary> {
    return { title: `Issue ${n}`, isPullRequest: false }
  }
}

/**
 * In-memory LockPort that models real semantics:
 *  - PUT-on-empty-key wins (returns lease).
 *  - PUT while key held returns null UNLESS the TTL has expired (uses
 *    injectable `now` for deterministic tests).
 *  - release() clears the slot.
 */
class FakeLock implements LockPort {
  private slots = new Map<string, { acquiredAt: number; ttlMs: number }>()
  /** Tests can advance the clock by setting `now`. */
  now = 0

  async acquire(key: string, ttlMs: number): Promise<Lease | null> {
    const held = this.slots.get(key)
    if (held && this.now - held.acquiredAt < held.ttlMs) {
      return null
    }
    this.slots.set(key, { acquiredAt: this.now, ttlMs })
    return {
      release: async () => {
        // Idempotent — only delete if our entry is still the latest.
        const current = this.slots.get(key)
        if (current && current.acquiredAt === this.now) {
          this.slots.delete(key)
        }
      },
    }
  }
}

describe('BranchService — per-issue lock', () => {
  let repo: StubRepo
  let lock: FakeLock
  let svc: BranchService

  beforeEach(() => {
    repo = new StubRepo()
    lock = new FakeLock()
    svc = new BranchService(repo, lock)
  })

  it('acquires a lease keyed on issue-<n> and releases on success', async () => {
    await svc.getOrCreate({ issueNumber: 42 })
    // Lease released → next call succeeds without contention
    await expect(svc.getOrCreate({ issueNumber: 42 })).resolves.toMatchObject({
      existed: true,
    })
  })

  it('throws LockTakenError when another session holds the lease', async () => {
    // Simulate another caller holding the lease NOW.
    const otherLease = await lock.acquire('issue-42', 300_000)
    expect(otherLease).not.toBeNull()

    await expect(svc.getOrCreate({ issueNumber: 42 })).rejects.toBeInstanceOf(
      LockTakenError,
    )
  })

  it('releases the lease even when getOrCreate throws', async () => {
    // Pre-create a foreign branch so getOrCreate rejects after acquiring.
    repo.branches.set('42-issue-42', {
      sha: 'sha-foreign',
      messages: ['feat: human work'],
    })

    await expect(svc.getOrCreate({ issueNumber: 42 })).rejects.toThrow()

    // Lease must have been released — next acquire should succeed.
    const next = await lock.acquire('issue-42', 300_000)
    expect(next).not.toBeNull()
  })

  it('locks are scoped by issue number — different issues do not contend', async () => {
    await lock.acquire('issue-99', 300_000)
    // issue-42 is independent — should still acquire.
    await expect(svc.getOrCreate({ issueNumber: 42 })).resolves.toBeDefined()
  })

  it('allows a takeover after the TTL expires', async () => {
    // Existing holder acquired at t=0 with 5min TTL.
    await lock.acquire('issue-42', 5 * 60_000)
    // Advance clock past the TTL.
    lock.now = 6 * 60_000
    await expect(svc.getOrCreate({ issueNumber: 42 })).resolves.toBeDefined()
  })

  it('is a no-op when no LockPort is configured (backward compat)', async () => {
    const svcNoLock = new BranchService(repo)
    await expect(svcNoLock.getOrCreate({ issueNumber: 42 })).resolves.toMatchObject({
      existed: false,
    })
  })
})
