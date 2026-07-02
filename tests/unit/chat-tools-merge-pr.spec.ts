/**
 * @fileoverview Unit tests for the in-process `merge_pr` chat tool
 * (added in issue #124). The tool is destructive — it merges a PR into
 * the base branch — so it must:
 *   1. Refuse on a draft PR.
 *   2. Refuse on merge conflicts / branch-protection / failing required
 *      CI (PR not mergeable, merge endpoint returns a 405/409/422).
 *   3. Default to the squash strategy; honour `merge` and `rebase`.
 *   4. NOT delete the source branch by default; honour opt-in
 *      `deleteBranch: true`.
 *   5. Verify the merge landed by re-reading the PR (closed + merged:
 *      true) and surface the merged commit SHA + strategy in chat.
 *   6. Surface the GitHub API error verbatim on failure.
 *
 * The AI SDK's `tool()` returns an object with an `execute` function we
 * can call directly from tests. Octokit is mocked at the boundary — a
 * fake `rest` object with `pulls.get`, `pulls.merge`, `issues.get`,
 * `git.deleteRef` is all the merge path needs.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const pullsGet = vi.hoisted(() => vi.fn());
const pullsMerge = vi.hoisted(() => vi.fn());
const gitDeleteRef = vi.hoisted(() => vi.fn());
const invalidateIssueCache = vi.hoisted(() => vi.fn());
const invalidatePRCache = vi.hoisted(() => vi.fn());

vi.mock("@dashboard/lib/github-client", () => ({
  invalidateIssueCache: (...a: unknown[]) => invalidateIssueCache(...a),
  invalidatePRCache: (...a: unknown[]) => invalidatePRCache(...a),
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Imported AFTER the mocks so the tool binds to the fakes.
import { createGitHubTools } from "../../app/api/kody/chat/tools/github-tools";

const OWNER = "acme";
const REPO = "widgets";
const PR_NUMBER = 7;

function makeCtx() {
  const octokit = {
    rest: {
      pulls: {
        get: (...a: unknown[]) => pullsGet(...a),
        merge: (...a: unknown[]) => pullsMerge(...a),
      },
      git: {
        deleteRef: (...a: unknown[]) => gitDeleteRef(...a),
      },
    },
  };
  return { octokit: octokit as never, owner: OWNER, repo: REPO };
}

function prFixture(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      number: PR_NUMBER,
      title: "Fix the widget",
      state: "open",
      draft: false,
      merged: false,
      mergeable: true,
      mergeable_state: "clean",
      user: { login: "alice" },
      head: { ref: "feature/widget", sha: "abc123" },
      base: { ref: "main" },
      html_url: `https://github.com/${OWNER}/${REPO}/pull/${PR_NUMBER}`,
      ...overrides,
    },
  };
}

beforeEach(() => {
  pullsGet.mockReset();
  pullsMerge.mockReset();
  gitDeleteRef.mockReset();
  invalidateIssueCache.mockReset();
  invalidatePRCache.mockReset();
});

describe("merge_pr — happy path", () => {
  it("merges with squash by default and re-reads the PR to confirm", async () => {
    // First pulls.get = pre-merge sanity check (draft, mergeable, etc.)
    pullsGet.mockResolvedValueOnce(prFixture());
    // pulls.merge returns the SHA
    pullsMerge.mockResolvedValueOnce({
      data: { sha: "deadbeef", merged: true, message: "PR merged" },
    });
    // Second pulls.get = post-merge re-fetch for confirmation
    pullsGet.mockResolvedValueOnce(
      prFixture({ state: "closed", merged: true }),
    );

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
    })) as {
      ok: boolean;
      prNumber: number;
      sha: string;
      strategy: string;
      branchDeleted: boolean;
      url: string;
    };

    expect(result.ok).toBe(true);
    expect(result.prNumber).toBe(PR_NUMBER);
    expect(result.sha).toBe("deadbeef");
    expect(result.strategy).toBe("squash");
    expect(result.branchDeleted).toBe(false);
    expect(result.url).toBe(`/repo/${OWNER}/${REPO}/${PR_NUMBER}`);
    // Default squash was passed to the GitHub merge endpoint.
    expect(pullsMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: OWNER,
        repo: REPO,
        pull_number: PR_NUMBER,
        merge_method: "squash",
      }),
    );
    // Re-fetch happened after merge to verify state.
    expect(pullsGet).toHaveBeenCalledTimes(2);
    // Branch delete was NOT called (default off).
    expect(gitDeleteRef).not.toHaveBeenCalled();
  });

  it("supports the merge strategy when explicitly requested", async () => {
    pullsGet.mockResolvedValueOnce(prFixture());
    pullsMerge.mockResolvedValueOnce({
      data: { sha: "cafef00d", merged: true },
    });
    pullsGet.mockResolvedValueOnce(
      prFixture({ state: "closed", merged: true }),
    );

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
      strategy: "merge",
    })) as { strategy: string };

    expect(result.strategy).toBe("merge");
    expect(pullsMerge).toHaveBeenCalledWith(
      expect.objectContaining({ merge_method: "merge" }),
    );
  });

  it("supports the rebase strategy when explicitly requested", async () => {
    pullsGet.mockResolvedValueOnce(prFixture());
    pullsMerge.mockResolvedValueOnce({
      data: { sha: "rebase01", merged: true },
    });
    pullsGet.mockResolvedValueOnce(
      prFixture({ state: "closed", merged: true }),
    );

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
      strategy: "rebase",
    })) as { strategy: string };

    expect(result.strategy).toBe("rebase");
    expect(pullsMerge).toHaveBeenCalledWith(
      expect.objectContaining({ merge_method: "rebase" }),
    );
  });

  it("deletes the head branch when deleteBranch is true (opt-in)", async () => {
    pullsGet.mockResolvedValueOnce(prFixture());
    pullsMerge.mockResolvedValueOnce({ data: { sha: "x", merged: true } });
    pullsGet.mockResolvedValueOnce(
      prFixture({ state: "closed", merged: true }),
    );
    gitDeleteRef.mockResolvedValueOnce({ data: {} });

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
      deleteBranch: true,
    })) as { branchDeleted: boolean };

    expect(result.branchDeleted).toBe(true);
    expect(gitDeleteRef).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: OWNER,
        repo: REPO,
        ref: "heads/feature/widget",
      }),
    );
  });

  it("invalidates the PR + issue caches after a successful merge", async () => {
    pullsGet.mockResolvedValueOnce(prFixture());
    pullsMerge.mockResolvedValueOnce({ data: { sha: "x", merged: true } });
    pullsGet.mockResolvedValueOnce(
      prFixture({ state: "closed", merged: true }),
    );

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    await tools.merge_pr.execute({ prNumber: PR_NUMBER });

    expect(invalidatePRCache).toHaveBeenCalled();
    expect(invalidateIssueCache).toHaveBeenCalledWith(PR_NUMBER);
  });
});

describe("merge_pr — blocking-state refusals", () => {
  it("refuses to merge a draft PR and does NOT call the merge endpoint", async () => {
    pullsGet.mockResolvedValueOnce(prFixture({ draft: true }));

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
    })) as { error: string };

    expect(result.error).toMatch(/draft/i);
    expect(pullsMerge).not.toHaveBeenCalled();
  });

  it("refuses to merge when the PR has merge conflicts (mergeable=false)", async () => {
    pullsGet.mockResolvedValueOnce(
      prFixture({ mergeable: false, mergeable_state: "dirty" }),
    );

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
    })) as { error: string };

    expect(result.error).toMatch(/conflict/i);
    expect(pullsMerge).not.toHaveBeenCalled();
  });

  it("refuses when the PR is blocked by branch protection / required CI", async () => {
    pullsGet.mockResolvedValueOnce(
      prFixture({ mergeable: false, mergeable_state: "blocked" }),
    );

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
    })) as { error: string };

    expect(result.error).toMatch(/blocked|branch.protection|ci/i);
    expect(pullsMerge).not.toHaveBeenCalled();
  });
});

describe("merge_pr — error surfacing", () => {
  it("returns a clear error when the GitHub merge API rejects (e.g. CI fail, 405)", async () => {
    pullsGet.mockResolvedValueOnce(prFixture());
    pullsMerge.mockRejectedValueOnce(
      Object.assign(new Error("Merge not allowed"), { status: 405 }),
    );

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
    })) as { error: string };

    expect(result.error).toMatch(/merge not allowed|405|not mergeable/i);
  });

  it("classifies a conflict error (status 409) so the chat message is clear", async () => {
    pullsGet.mockResolvedValueOnce(prFixture());
    pullsMerge.mockRejectedValueOnce(
      Object.assign(new Error("merge conflict"), { status: 409 }),
    );

    const tools = createGitHubTools(makeCtx()) as unknown as {
      merge_pr: { execute: (input: unknown) => Promise<unknown> };
    };
    const result = (await tools.merge_pr.execute({
      prNumber: PR_NUMBER,
    })) as { error: string };

    expect(result.error).toMatch(/conflict/i);
  });
});
