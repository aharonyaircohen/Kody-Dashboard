import { beforeEach, describe, expect, it } from 'vitest'
import { BranchService } from '@dashboard/lib/branches/application/branch-service'
import { ForeignBranchError } from '@dashboard/lib/branches/errors'
import type {
  BranchRepo,
  CompareStatus,
  CreateBranchResult,
  IssueSummary,
  MergeResult,
  OpenPR,
} from '@dashboard/lib/branches/infra/github-branch-repo'

/**
 * In-memory BranchRepo for service-level integration tests.
 *
 * Models just enough GitHub semantics to exercise BranchService's
 * decision points: branch existence, ownership marker presence, status
 * of base-vs-branch, PR existence, deletion behaviour.
 */
class FakeBranchRepo implements BranchRepo {
  defaultBranch = 'main'
  /** key: branchName → { sha, commitMessages } */
  branches = new Map<
    string,
    { sha: string; commitMessages: string[] }
  >([['main', { sha: 'sha-main', commitMessages: [] }]])
  /** key: branchName → openPRs[] */
  openPRs = new Map<string, OpenPR[]>()
  issues = new Map<number, IssueSummary>([
    [42, { title: 'Fix the thing', isPullRequest: false }],
    [99, { title: 'It is actually a PR', isPullRequest: true }],
  ])
  /** Configurable result for the next compareCommits call. */
  compareResult: { status: CompareStatus; mergeBaseSha: string } = {
    status: 'identical',
    mergeBaseSha: 'sha-main',
  }
  /** Configurable result for the next merge call. */
  mergeResult: MergeResult = { kind: 'merged', sha: 'sha-merged' }
  /** Counters for call assertions. */
  calls = {
    createDraftPR: 0,
    deleteBranch: 0,
    fastForward: 0,
    merge: 0,
    listBranchCommitMessages: 0,
  }

  async getDefaultBranch(): Promise<string> {
    return this.defaultBranch
  }

  async getRefSha(ref: string): Promise<string> {
    const b = this.branches.get(ref)
    if (!b) throw new Error(`No such ref: ${ref}`)
    return b.sha
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
      commitMessages: [input.markerMessage],
    })
    return { sha, existed: false }
  }

  async compareCommits(): Promise<{ status: CompareStatus; mergeBaseSha: string }> {
    return this.compareResult
  }

  async listBranchCommitMessages(input: {
    branchName: string
    baseRef: string
  }): Promise<string[]> {
    this.calls.listBranchCommitMessages++
    const b = this.branches.get(input.branchName)
    return b ? [...b.commitMessages] : []
  }

  async fastForward(input: { branchName: string; targetSha: string }): Promise<void> {
    this.calls.fastForward++
    const b = this.branches.get(input.branchName)
    if (!b) throw new Error(`No such branch: ${input.branchName}`)
    b.sha = input.targetSha
  }

  async merge(): Promise<MergeResult> {
    this.calls.merge++
    return this.mergeResult
  }

  async listOpenPRsForBranch(branchName: string): Promise<OpenPR[]> {
    return this.openPRs.get(branchName) ?? []
  }

  async createDraftPR(input: {
    head: string
    base: string
    title: string
    body: string
  }): Promise<OpenPR> {
    this.calls.createDraftPR++
    const pr: OpenPR = {
      number: 1000 + this.calls.createDraftPR,
      htmlUrl: `https://example.test/pr/${1000 + this.calls.createDraftPR}`,
    }
    const existing = this.openPRs.get(input.head) ?? []
    this.openPRs.set(input.head, [...existing, pr])
    return pr
  }

  async deleteBranch(branchName: string): Promise<void> {
    this.calls.deleteBranch++
    if (!this.branches.has(branchName)) {
      const e: Error & { status?: number } = new Error('Reference does not exist')
      e.status = 422
      throw e
    }
    this.branches.delete(branchName)
  }

  async getIssue(issueNumber: number): Promise<IssueSummary> {
    const i = this.issues.get(issueNumber)
    if (!i) throw new Error(`No such issue: #${issueNumber}`)
    return i
  }
}

describe('BranchService.getOrCreate', () => {
  let repo: FakeBranchRepo
  let svc: BranchService

  beforeEach(() => {
    repo = new FakeBranchRepo()
    svc = new BranchService(repo)
  })

  it('creates a new branch from the default base when issue exists', async () => {
    const result = await svc.getOrCreate({ issueNumber: 42 })
    expect(result.branchName).toBe('42-fix-the-thing')
    expect(result.existed).toBe(false)
    expect(result.baseRef).toBe('main')
    expect(repo.branches.has('42-fix-the-thing')).toBe(true)
  })

  it('accepts an explicit slug override', async () => {
    const result = await svc.getOrCreate({ issueNumber: 42, slug: 'custom-slug' })
    expect(result.branchName).toBe('42-custom-slug')
  })

  it('accepts an explicit baseRef override', async () => {
    repo.branches.set('release-1.0', { sha: 'sha-release', commitMessages: [] })
    const result = await svc.getOrCreate({ issueNumber: 42, baseRef: 'release-1.0' })
    expect(result.baseRef).toBe('release-1.0')
  })

  it('rejects issueNumber that points to a PR, not an issue', async () => {
    await expect(svc.getOrCreate({ issueNumber: 99 })).rejects.toThrow(
      /is a pull request/,
    )
  })

  it('reuses a Kody-owned branch when the marker matches', async () => {
    // Seed a Kody-owned branch for issue 42
    repo.branches.set('42-fix-the-thing', {
      sha: 'sha-existing',
      commitMessages: [
        'vibe: start session for #42',
        'fix: real work',
      ],
    })

    const result = await svc.getOrCreate({ issueNumber: 42 })
    expect(result.existed).toBe(true)
    expect(repo.calls.listBranchCommitMessages).toBe(1)
  })

  it('REJECTS a foreign branch with the same name but no marker', async () => {
    // Pre-existing human branch with same slug — no marker
    repo.branches.set('42-fix-the-thing', {
      sha: 'sha-foreign',
      commitMessages: ['feat: human work'],
    })

    await expect(svc.getOrCreate({ issueNumber: 42 })).rejects.toBeInstanceOf(
      ForeignBranchError,
    )
  })

  it('REJECTS a branch with a marker for a DIFFERENT issue (slug collision)', async () => {
    // Existing Kody branch from issue #5 with same slug as issue #42's title
    repo.branches.set('42-fix-the-thing', {
      sha: 'sha-other',
      commitMessages: ['vibe: start session for #5'],
    })

    await expect(svc.getOrCreate({ issueNumber: 42 })).rejects.toBeInstanceOf(
      ForeignBranchError,
    )
  })
})

describe('BranchService.syncWithBase', () => {
  let repo: FakeBranchRepo
  let svc: BranchService

  beforeEach(() => {
    repo = new FakeBranchRepo()
    repo.branches.set('42-fix', { sha: 'sha-branch', commitMessages: ['vibe: start session for #42'] })
    svc = new BranchService(repo)
  })

  it('is a no-op when branch is identical to base', async () => {
    repo.compareResult = { status: 'identical', mergeBaseSha: 'sha-main' }
    const result = await svc.syncWithBase('42-fix')
    expect(result.status).toBe('identical')
    expect(repo.calls.fastForward).toBe(0)
    expect(repo.calls.merge).toBe(0)
  })

  it('is a no-op when branch is ahead of base (branch has unique work)', async () => {
    repo.compareResult = { status: 'ahead', mergeBaseSha: 'sha-main' }
    const result = await svc.syncWithBase('42-fix')
    expect(result.status).toBe('ahead')
    expect(repo.calls.fastForward).toBe(0)
    expect(repo.calls.merge).toBe(0)
  })

  it('fast-forwards when branch is behind base', async () => {
    repo.compareResult = { status: 'behind', mergeBaseSha: 'sha-main' }
    const result = await svc.syncWithBase('42-fix')
    expect(result.status).toBe('fast-forwarded')
    expect(repo.calls.fastForward).toBe(1)
    expect(repo.calls.merge).toBe(0)
  })

  it('merges base into branch when diverged', async () => {
    repo.compareResult = { status: 'diverged', mergeBaseSha: 'sha-merge-base' }
    repo.mergeResult = { kind: 'merged', sha: 'sha-merged' }
    const result = await svc.syncWithBase('42-fix')
    expect(result.status).toBe('merged')
    expect(repo.calls.merge).toBe(1)
    expect(repo.calls.fastForward).toBe(0)
    if (result.status === 'merged') {
      expect(result.headSha).toBe('sha-merged')
    }
  })

  it('returns a conflict status (not throw) when merge hits a conflict', async () => {
    repo.compareResult = { status: 'diverged', mergeBaseSha: 'sha-merge-base' }
    repo.mergeResult = { kind: 'conflict', message: 'Merge conflict in foo.ts' }
    const result = await svc.syncWithBase('42-fix')
    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.message).toMatch(/conflict/i)
    }
  })
})

describe('BranchService.findOrCreateDraftPR', () => {
  let repo: FakeBranchRepo
  let svc: BranchService

  beforeEach(() => {
    repo = new FakeBranchRepo()
    svc = new BranchService(repo)
  })

  it('returns the existing PR when one is already open', async () => {
    const existing: OpenPR = { number: 7, htmlUrl: 'https://example.test/pr/7' }
    repo.openPRs.set('42-fix', [existing])

    const result = await svc.findOrCreateDraftPR({
      branchName: '42-fix',
      baseRef: 'main',
      title: 'irrelevant',
      body: 'irrelevant',
    })

    expect(result.created).toBe(false)
    expect(result.number).toBe(7)
    expect(repo.calls.createDraftPR).toBe(0)
  })

  it('opens a new draft PR when none exists', async () => {
    const result = await svc.findOrCreateDraftPR({
      branchName: '42-fix',
      baseRef: 'main',
      title: 'Vibe: Fix the thing',
      body: 'Closes #42',
    })

    expect(result.created).toBe(true)
    expect(result.number).toBeGreaterThan(1000)
    expect(repo.calls.createDraftPR).toBe(1)
  })
})

describe('BranchService.delete', () => {
  let repo: FakeBranchRepo
  let svc: BranchService

  beforeEach(() => {
    repo = new FakeBranchRepo()
    repo.branches.set('42-fix', { sha: 'sha-branch', commitMessages: [] })
    svc = new BranchService(repo)
  })

  it('refuses to delete a protected branch (main / master / dev)', async () => {
    for (const name of ['main', 'master', 'dev']) {
      const result = await svc.delete(name)
      expect(result.deleted).toBe(false)
      expect(result.reason).toBe('protected')
    }
    expect(repo.calls.deleteBranch).toBe(0)
  })

  it('refuses to delete protected names case-insensitively', async () => {
    const result = await svc.delete('MAIN')
    expect(result.deleted).toBe(false)
    expect(result.reason).toBe('protected')
  })

  it('deletes a regular branch', async () => {
    const result = await svc.delete('42-fix')
    expect(result.deleted).toBe(true)
    expect(repo.branches.has('42-fix')).toBe(false)
  })

  it('returns reason="not-found" when the branch is already gone (idempotent)', async () => {
    const result = await svc.delete('never-existed')
    expect(result.deleted).toBe(false)
    expect(result.reason).toBe('not-found')
  })
})
