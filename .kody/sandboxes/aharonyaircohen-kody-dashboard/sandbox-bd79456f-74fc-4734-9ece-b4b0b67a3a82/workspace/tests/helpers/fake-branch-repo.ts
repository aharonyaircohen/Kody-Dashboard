/**
 * @fileoverview Shared in-memory `BranchRepo` (and a fake `LockPort`) for
 * service-level integration tests. Models just enough GitHub semantics to
 * exercise `BranchService`'s decision points: branch existence, ownership
 * marker presence, base-vs-branch status, PR existence, deletion behaviour.
 *
 * Not a `*.spec.ts` file, so vitest's `tests/**\/*.spec.ts` include never
 * runs it as a test — it's a fixture imported by the branch + vibe specs.
 */

import type { Lease, LockPort } from "@dashboard/lib/branches/domain/lock-port";
import type {
  BranchRepo,
  CompareStatus,
  CreateBranchResult,
  IssueSummary,
  MergeResult,
  OpenPR,
} from "@dashboard/lib/branches/infra/github-branch-repo";

export class FakeBranchRepo implements BranchRepo {
  defaultBranch = "main";
  /** key: branchName → { sha, commitMessages } */
  branches = new Map<string, { sha: string; commitMessages: string[] }>([
    ["main", { sha: "sha-main", commitMessages: [] }],
  ]);
  /** key: branchName → openPRs[] */
  openPRs = new Map<string, OpenPR[]>();
  issues = new Map<number, IssueSummary>([
    [42, { title: "Fix the thing", isPullRequest: false }],
    [99, { title: "It is actually a PR", isPullRequest: true }],
  ]);
  /** Configurable result for the next compareCommits call. */
  compareResult: { status: CompareStatus; mergeBaseSha: string } = {
    status: "identical",
    mergeBaseSha: "sha-main",
  };
  /** Configurable result for the next merge call. */
  mergeResult: MergeResult = { kind: "merged", sha: "sha-merged" };
  /** Counters for call assertions. */
  calls = {
    createDraftPR: 0,
    deleteBranch: 0,
    fastForward: 0,
    merge: 0,
    listBranchCommitMessages: 0,
  };

  async getDefaultBranch(): Promise<string> {
    return this.defaultBranch;
  }

  async getRefSha(ref: string): Promise<string> {
    const b = this.branches.get(ref);
    if (!b) throw new Error(`No such ref: ${ref}`);
    return b.sha;
  }

  async createBranchWithMarker(input: {
    branchName: string;
    baseRef: string;
    markerMessage: string;
  }): Promise<CreateBranchResult> {
    if (this.branches.has(input.branchName)) {
      return { sha: this.branches.get(input.branchName)!.sha, existed: true };
    }
    const sha = `sha-${input.branchName}`;
    this.branches.set(input.branchName, {
      sha,
      commitMessages: [input.markerMessage],
    });
    return { sha, existed: false };
  }

  async compareCommits(): Promise<{
    status: CompareStatus;
    mergeBaseSha: string;
  }> {
    return this.compareResult;
  }

  async listBranchCommitMessages(input: {
    branchName: string;
    baseRef: string;
  }): Promise<string[]> {
    this.calls.listBranchCommitMessages++;
    const b = this.branches.get(input.branchName);
    return b ? [...b.commitMessages] : [];
  }

  async fastForward(input: {
    branchName: string;
    targetSha: string;
  }): Promise<void> {
    this.calls.fastForward++;
    const b = this.branches.get(input.branchName);
    if (!b) throw new Error(`No such branch: ${input.branchName}`);
    b.sha = input.targetSha;
  }

  async merge(): Promise<MergeResult> {
    this.calls.merge++;
    return this.mergeResult;
  }

  async listOpenPRsForBranch(branchName: string): Promise<OpenPR[]> {
    return this.openPRs.get(branchName) ?? [];
  }

  async createDraftPR(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<OpenPR> {
    this.calls.createDraftPR++;
    const pr: OpenPR = {
      number: 1000 + this.calls.createDraftPR,
      htmlUrl: `https://example.test/pr/${1000 + this.calls.createDraftPR}`,
    };
    const existing = this.openPRs.get(input.head) ?? [];
    this.openPRs.set(input.head, [...existing, pr]);
    return pr;
  }

  async deleteBranch(branchName: string): Promise<void> {
    this.calls.deleteBranch++;
    if (!this.branches.has(branchName)) {
      const e: Error & { status?: number } = new Error(
        "Reference does not exist",
      );
      e.status = 422;
      throw e;
    }
    this.branches.delete(branchName);
  }

  async getIssue(issueNumber: number): Promise<IssueSummary> {
    const i = this.issues.get(issueNumber);
    if (!i) throw new Error(`No such issue: #${issueNumber}`);
    return i;
  }
}

/**
 * In-memory `LockPort`. By default every `acquire` succeeds. Set
 * `available = false` to simulate contention (another vibe session already
 * holds the lease) — `acquire` then returns `null`, which makes
 * `BranchService.getOrCreate` throw `LockTakenError`.
 */
export class FakeLock implements LockPort {
  available = true;
  released = 0;

  async acquire(): Promise<Lease | null> {
    if (!this.available) return null;
    return {
      release: async () => {
        this.released++;
      },
    };
  }
}
