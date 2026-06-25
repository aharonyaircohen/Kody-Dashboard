/**
 * @fileType utility
 * @domain sandboxes
 * @pattern github-actions-sandbox-snapshot-publish
 */
import { readFile } from "node:fs/promises";
import type { Octokit } from "@octokit/rest";
import type { NextRequest } from "next/server";
import { getUserOctokit } from "@dashboard/lib/auth";
import {
  readStateFileMetadata,
  writeStateBase64,
} from "@dashboard/lib/state-repo";
import type { LocalSandbox } from "./local-sandboxes";

interface GitHubRepoAuth {
  owner: string;
  repo: string;
}

async function getExistingFileSha(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  path: string,
): Promise<string | undefined> {
  const file = await readStateFileMetadata(octokit, auth.owner, auth.repo, path);
  return file?.sha;
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
  return `sandboxes/${sandbox.scope}/${sandbox.id}/snapshot.tar.gz.enc`;
}

export async function publishGitHubActionsSandboxSnapshotWithOctokit(
  octokit: Octokit,
  auth: GitHubRepoAuth,
  sandbox: LocalSandbox,
): Promise<void> {
  const path = githubActionsSandboxSnapshotPath(sandbox);
  const content = await readFile(sandbox.snapshotPath, "base64");
  const sha = await getExistingFileSha(octokit, auth, path);

  await writeStateBase64({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
    path,
    message: `chore(kody): save sandbox ${sandbox.id} [skip ci]`,
    contentBase64: content,
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
