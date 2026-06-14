/**
 * @fileType utility
 * @domain sandboxes
 * @pattern github-actions-sandbox-snapshot-publish
 */
import { readFile } from "node:fs/promises";
import type { Octokit } from "@octokit/rest";
import type { NextRequest } from "next/server";
import { getUserOctokit } from "@dashboard/lib/auth";
import type { LocalSandbox } from "./local-sandboxes";

interface GitHubRepoAuth {
  owner: string;
  repo: string;
}

const BRANCH = "main";

async function getExistingFileSha(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  path: string,
): Promise<string | undefined> {
  try {
    const res = await octokit.repos.getContent({
      owner: auth.owner,
      repo: auth.repo,
      path,
      ref: BRANCH,
    });
    return !Array.isArray(res.data) && res.data.type === "file"
      ? res.data.sha
      : undefined;
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      err.status === 404
    ) {
      return undefined;
    }
    throw err;
  }
}

export async function hasGitHubActionsSandboxSnapshot(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  sandbox: LocalSandbox,
): Promise<boolean> {
  const path = githubActionsSandboxSnapshotPath(sandbox);
  return (await getExistingFileSha(octokit, auth, path)) !== undefined;
}

export function githubActionsSandboxSnapshotPath(
  sandbox: LocalSandbox,
): string {
  return `.kody/sandboxes/${sandbox.scope}/${sandbox.id}/snapshot.tar.gz.enc`;
}

export async function publishGitHubActionsSandboxSnapshotWithOctokit(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  sandbox: LocalSandbox,
): Promise<void> {
  const path = githubActionsSandboxSnapshotPath(sandbox);
  const content = await readFile(sandbox.snapshotPath, "base64");
  const sha = await getExistingFileSha(octokit, auth, path);

  await octokit.repos.createOrUpdateFileContents({
    owner: auth.owner,
    repo: auth.repo,
    path,
    message: `chore(kody): save sandbox ${sandbox.id} [skip ci]`,
    content,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  });
}

export async function ensureGitHubActionsSandboxSnapshotWithOctokit(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  sandbox: LocalSandbox,
): Promise<void> {
  if (await hasGitHubActionsSandboxSnapshot(octokit, auth, sandbox)) return;
  await publishGitHubActionsSandboxSnapshotWithOctokit(octokit, auth, sandbox);
}

export async function publishGitHubActionsSandboxSnapshot(
  req: NextRequest,
  auth: GitHubRepoAuth,
  sandbox: LocalSandbox,
): Promise<void> {
  const octokit = await getUserOctokit(req);
  if (!octokit) throw new Error("No GitHub token available");
  await publishGitHubActionsSandboxSnapshotWithOctokit(octokit, auth, sandbox);
}
