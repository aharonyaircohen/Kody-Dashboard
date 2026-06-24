/**
 * @testFramework vitest
 * @domain sandboxes
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ensureGitHubActionsSandboxSnapshotWithOctokit,
  githubActionsSandboxSnapshotPath,
  publishGitHubActionsSandboxSnapshotWithOctokit,
} from "@dashboard/lib/sandboxes/github-actions-snapshot";
import type { LocalSandbox } from "@dashboard/lib/sandboxes/local-sandboxes";

function sandbox(snapshotPath: string): LocalSandbox {
  return {
    id: "sandbox-00000000-0000-4000-8000-000000000000",
    name: "GitHub sandbox",
    runtime: "github-actions",
    scope: "owner-repo",
    rootDir: "",
    homeDir: "",
    workspaceDir: "",
    snapshotPath,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    snapshotUpdatedAt: "2026-06-14T00:00:00.000Z",
  };
}

describe("githubActionsSandboxSnapshotPath", () => {
  it("matches the path restored by the GitHub Actions workflow", () => {
    expect(githubActionsSandboxSnapshotPath(sandbox("/tmp/snapshot"))).toBe(
      ".kody/sandboxes/owner-repo/sandbox-00000000-0000-4000-8000-000000000000/snapshot.tar.gz.enc",
    );
  });
});

describe("publishGitHubActionsSandboxSnapshotWithOctokit", () => {
  it("publishes the encrypted snapshot to the workflow restore path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kody-snapshot-"));
    const snapshotPath = join(dir, "snapshot.tar.gz.enc");
    await writeFile(snapshotPath, "snapshot bytes");
    const octokit = {
      repos: {
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
      },
    };

    await publishGitHubActionsSandboxSnapshotWithOctokit(
      octokit as never,
      { owner: "owner", repo: "repo" },
      sandbox(snapshotPath),
    );

    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "owner",
        repo: "repo",
        branch: "main",
        path: githubActionsSandboxSnapshotPath(sandbox(snapshotPath)),
        content: Buffer.from("snapshot bytes").toString("base64"),
      }),
    );
  });
});

describe("ensureGitHubActionsSandboxSnapshotWithOctokit", () => {
  it("does not overwrite an existing remote snapshot", async () => {
    const octokit = {
      repos: {
        getContent: vi.fn().mockResolvedValue({
          data: { type: "file", sha: "remote-sha" },
        }),
        createOrUpdateFileContents: vi.fn(),
      },
    };

    await ensureGitHubActionsSandboxSnapshotWithOctokit(
      octokit as never,
      { owner: "owner", repo: "repo" },
      sandbox("/tmp/snapshot"),
    );

    expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });
});
