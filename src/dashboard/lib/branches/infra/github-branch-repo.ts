/**
 * @fileType module
 * @domain branches
 * @pattern repository-adapter
 * @ai-summary The only place in the branches module that talks to GitHub.
 *
 *   `BranchRepo` is the port; `GitHubBranchRepo` is the Octokit-backed
 *   adapter. Tests substitute a fake `BranchRepo` to exercise the
 *   `BranchService` without hitting the network.
 *
 *   Methods return plain data, never Octokit response shapes. This keeps
 *   the application layer ignorant of which infra it's running against.
 */
import type { Octokit } from "@octokit/rest";

export type CompareStatus = "identical" | "ahead" | "behind" | "diverged";

export interface CreateBranchResult {
  /** SHA of the new HEAD commit (the empty-commit ownership marker). */
  sha: string;
  /** True when the branch already existed and we couldn't create it. */
  existed: boolean;
}

export type MergeResult =
  | { kind: "merged"; sha: string }
  | { kind: "conflict"; message: string };

export interface OpenPR {
  number: number;
  htmlUrl: string;
}

export interface IssueSummary {
  title: string;
  isPullRequest: boolean;
}

export interface BranchRepo {
  getDefaultBranch(): Promise<string>;
  getRefSha(ref: string): Promise<string>;
  /**
   * Create `branchName` from `baseRef` with a single empty commit. The
   * empty commit serves as a Kody-ownership marker (a foreign branch
   * with the same name won't have this marker; later iterations can
   * verify before reusing).
   *
   * If the branch already exists, returns `{ existed: true }` and the
   * caller is responsible for syncing it.
   */
  createBranchWithMarker(input: {
    branchName: string;
    baseRef: string;
    markerMessage: string;
  }): Promise<CreateBranchResult>;

  compareCommits(input: {
    base: string;
    head: string;
  }): Promise<{ status: CompareStatus; mergeBaseSha: string }>;

  /**
   * Returns commit messages on `branchName` that are not yet on
   * `baseRef`. Used by the ownership guard to look for the
   * "vibe: start session for #N" marker on a reused branch.
   */
  listBranchCommitMessages(input: {
    branchName: string;
    baseRef: string;
  }): Promise<string[]>;

  fastForward(input: { branchName: string; targetSha: string }): Promise<void>;

  merge(input: {
    base: string;
    head: string;
    commitMessage: string;
  }): Promise<MergeResult>;

  listOpenPRsForBranch(branchName: string): Promise<OpenPR[]>;

  createDraftPR(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<OpenPR>;

  deleteBranch(branchName: string): Promise<void>;

  getIssue(issueNumber: number): Promise<IssueSummary>;
}

interface OctokitCtx {
  octokit: Octokit;
  owner: string;
  repo: string;
}

export class GitHubBranchRepo implements BranchRepo {
  constructor(private readonly ctx: OctokitCtx) {}

  async getDefaultBranch(): Promise<string> {
    const { data } = await this.ctx.octokit.rest.repos.get({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
    });
    return data.default_branch;
  }

  async getRefSha(ref: string): Promise<string> {
    const { data } = await this.ctx.octokit.rest.git.getRef({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      ref: `heads/${ref}`,
    });
    return data.object.sha;
  }

  async createBranchWithMarker(input: {
    branchName: string;
    baseRef: string;
    markerMessage: string;
  }): Promise<CreateBranchResult> {
    const { owner, repo, octokit } = this.ctx;
    try {
      const baseSha = await this.getRefSha(input.baseRef);
      const { data: baseCommit } = await octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: baseSha,
      });
      const { data: emptyCommit } = await octokit.rest.git.createCommit({
        owner,
        repo,
        message: input.markerMessage,
        tree: baseCommit.tree.sha,
        parents: [baseSha],
      });
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${input.branchName}`,
        sha: emptyCommit.sha,
      });
      return { sha: emptyCommit.sha, existed: false };
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 422) {
        // Branch already exists — caller decides whether to sync or reject.
        const sha = await this.getRefSha(input.branchName);
        return { sha, existed: true };
      }
      throw err;
    }
  }

  async compareCommits(input: {
    base: string;
    head: string;
  }): Promise<{ status: CompareStatus; mergeBaseSha: string }> {
    const { data } = await this.ctx.octokit.rest.repos.compareCommits({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      base: input.base,
      head: input.head,
    });
    return {
      status: data.status as CompareStatus,
      mergeBaseSha: data.merge_base_commit.sha,
    };
  }

  async listBranchCommitMessages(input: {
    branchName: string;
    baseRef: string;
  }): Promise<string[]> {
    // Call with base=baseRef, head=branchName so `commits` returns
    // commits unique to the branch (not yet on the base).
    const { data } = await this.ctx.octokit.rest.repos.compareCommits({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      base: input.baseRef,
      head: input.branchName,
    });
    return data.commits.map((c) => c.commit.message);
  }

  async fastForward(input: {
    branchName: string;
    targetSha: string;
  }): Promise<void> {
    await this.ctx.octokit.rest.git.updateRef({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      ref: `heads/${input.branchName}`,
      sha: input.targetSha,
      force: false,
    });
  }

  async merge(input: {
    base: string;
    head: string;
    commitMessage: string;
  }): Promise<MergeResult> {
    try {
      const { data } = await this.ctx.octokit.rest.repos.merge({
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        base: input.base,
        head: input.head,
        commit_message: input.commitMessage,
      });
      return { kind: "merged", sha: data.sha };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 409) {
        return {
          kind: "conflict",
          message: e.message ?? "Merge conflict",
        };
      }
      throw err;
    }
  }

  async listOpenPRsForBranch(branchName: string): Promise<OpenPR[]> {
    const { data } = await this.ctx.octokit.rest.pulls.list({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      head: `${this.ctx.owner}:${branchName}`,
      state: "open",
    });
    return data.map((pr) => ({ number: pr.number, htmlUrl: pr.html_url }));
  }

  async createDraftPR(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<OpenPR> {
    const { data } = await this.ctx.octokit.rest.pulls.create({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      title: input.title,
      head: input.head,
      base: input.base,
      draft: true,
      body: input.body,
    });
    return { number: data.number, htmlUrl: data.html_url };
  }

  async deleteBranch(branchName: string): Promise<void> {
    await this.ctx.octokit.rest.git.deleteRef({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      ref: `heads/${branchName}`,
    });
  }

  async getIssue(issueNumber: number): Promise<IssueSummary> {
    const { data } = await this.ctx.octokit.rest.issues.get({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      issue_number: issueNumber,
    });
    return {
      title: data.title,
      isPullRequest: Boolean(data.pull_request),
    };
  }
}
