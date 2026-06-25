/**
 * @fileType utility
 * @domain kody
 * @pattern state-repo
 * @ai-summary Resolves and accesses the external Kody runtime-state repo for
 *   the connected consumer repo. Runtime files live under
 *   `<state.path>/<relative-file>` in `state.repo`, not through the consumer repo.
 */

import type { Octokit } from "@octokit/rest";
import { writeGitHubFileWithRetry } from "@dashboard/lib/github-contents-write";
import { getEngineConfig, type KodyConfig } from "./engine/config";

export interface StateRepoState {
  repo: string;
  path: string;
}

export interface StateRepoTarget {
  owner: string;
  repo: string;
  basePath: string;
}

export interface StateRepoFile {
  path: string;
  content: string;
  sha: string;
  etag?: string;
  htmlUrl?: string;
  size?: number;
}

export interface StateRepoFileMetadata {
  path: string;
  sha: string;
  htmlUrl?: string;
  size?: number;
}

export interface StateRepoEntry {
  name: string;
  path: string;
  type: string;
  size?: number;
}

export interface StateRepoWriteFile {
  path: string;
  content: string;
}

interface ContentFile {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
  html_url?: string;
  size?: number;
}

interface ContentEntry {
  name?: string;
  path?: string;
  type?: string;
  size?: number;
}

type ConfigWithStateAliases = KodyConfig & {
  state?: Partial<StateRepoState>;
  stateRepo?: unknown;
  statePath?: unknown;
};

export function parseStateRepoSlug(
  slug: string,
  field = "stateRepo",
): { owner: string; repo: string } {
  const value = slug.trim();
  let repoPath = value;
  if (/^https?:\/\//i.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(
        `kody.config.json: ${field} must be a GitHub repository URL`,
      );
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      throw new Error(
        `kody.config.json: ${field} must be a https://github.com repository URL`,
      );
    }
    repoPath = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  }
  const parts = repoPath.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `kody.config.json: ${field} must be a https://github.com/owner/repo URL`,
    );
  }

  for (const part of parts) {
    if (!/^[A-Za-z0-9_.-]+$/.test(part)) {
      throw new Error(
        `kody.config.json: ${field} contains invalid repo part "${part}"`,
      );
    }
  }

  return { owner: parts[0], repo: parts[1] };
}

export function normalizeStatePath(raw: string, field = "statePath"): string {
  const value = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!value) throw new Error(`kody.config.json: ${field} must not be empty`);

  const parts = value.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new Error(
        `kody.config.json: ${field} must be a relative path without "." or ".."`,
      );
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(part)) {
      throw new Error(
        `kody.config.json: ${field} contains invalid path part "${part}"`,
      );
    }
  }

  return parts.join("/");
}

export function resolveStateRepoConfig(
  config: KodyConfig,
  owner: string,
  repo: string,
): StateRepoState {
  const cfg = config as ConfigWithStateAliases;
  const nested = cfg.state && typeof cfg.state === "object" ? cfg.state : {};
  const repoRaw =
    typeof cfg.stateRepo === "string" ? cfg.stateRepo : nested.repo;
  const pathRaw =
    typeof cfg.statePath === "string" ? cfg.statePath : nested.path;
  const stateRepo =
    typeof repoRaw === "string" && repoRaw.trim().length > 0
      ? repoRaw.trim()
      : `https://github.com/${owner}/kody-state`;
  parseStateRepoSlug(stateRepo);

  return {
    repo: stateRepo,
    path:
      typeof pathRaw === "string" && pathRaw.trim().length > 0
        ? normalizeStatePath(pathRaw)
        : normalizeStatePath(repo),
  };
}

export function parseStateRepo(
  config: KodyConfig,
  owner: string,
  repo: string,
): StateRepoTarget {
  const state = resolveStateRepoConfig(config, owner, repo);
  const parsed = parseStateRepoSlug(state.repo);
  return { owner: parsed.owner, repo: parsed.repo, basePath: state.path };
}

export async function resolveStateRepo(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<StateRepoTarget> {
  const { config } = await getEngineConfig(octokit, owner, repo);
  return parseStateRepo(config, owner, repo);
}

export function stateRepoPath(
  target: StateRepoTarget,
  filePath: string,
): string {
  const relative = normalizeStatePath(filePath, "state file path");
  return [target.basePath, relative].filter(Boolean).join("/");
}

export async function readStateText(
  octokit: Octokit,
  owner: string,
  repo: string,
  filePath: string,
  options: { headers?: Record<string, string> } = {},
): Promise<StateRepoFile | null> {
  const target = await resolveStateRepo(octokit, owner, repo);
  const path = stateRepoPath(target, filePath);
  try {
    const res = await octokit.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path,
      headers: options.headers,
    });
    const data = res.data as ContentFile | ContentFile[];
    if (Array.isArray(data) || data.type !== "file" || !data.content) {
      return null;
    }
    return {
      path,
      content: Buffer.from(
        data.content,
        (data.encoding ?? "base64") as BufferEncoding,
      ).toString("utf8"),
      sha: data.sha ?? "",
      etag: (res.headers as Record<string, string | undefined>)?.etag,
      htmlUrl: data.html_url,
      size: data.size,
    };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export async function readStateFileMetadata(
  octokit: Octokit,
  owner: string,
  repo: string,
  filePath: string,
): Promise<StateRepoFileMetadata | null> {
  const target = await resolveStateRepo(octokit, owner, repo);
  const path = stateRepoPath(target, filePath);
  try {
    const res = await octokit.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path,
    });
    const data = res.data as ContentFile | ContentFile[];
    if (Array.isArray(data) || data.type !== "file" || !data.sha) {
      return null;
    }
    return {
      path,
      sha: data.sha,
      htmlUrl: data.html_url,
      size: data.size,
    };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export async function listStateDirectory(
  octokit: Octokit,
  owner: string,
  repo: string,
  dirPath: string,
  options: { headers?: Record<string, string> } = {},
): Promise<{ entries: StateRepoEntry[]; etag?: string; targetPath: string }> {
  const target = await resolveStateRepo(octokit, owner, repo);
  const targetPath = stateRepoPath(target, dirPath);
  try {
    const res = await octokit.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path: targetPath,
      headers: options.headers,
    });
    const data = res.data as ContentEntry | ContentEntry[];
    return {
      entries: Array.isArray(data)
        ? data
            .filter(
              (entry): entry is StateRepoEntry =>
                typeof entry.name === "string" &&
                typeof entry.path === "string" &&
                typeof entry.type === "string",
            )
            .map((entry) => ({
              name: entry.name,
              path: entry.path,
              type: entry.type,
              size: entry.size,
            }))
        : [],
      etag: (res.headers as Record<string, string | undefined>)?.etag,
      targetPath,
    };
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return { entries: [], targetPath };
    }
    throw err;
  }
}

export async function writeStateText({
  octokit,
  owner,
  repo,
  path,
  content,
  message,
  sha,
  maxAttempts,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
  maxAttempts?: number;
}): Promise<{ sha: string | null }> {
  const target = await resolveStateRepo(octokit, owner, repo);
  const res = await writeGitHubFileWithRetry(octokit, {
    owner: target.owner,
    repo: target.repo,
    path: stateRepoPath(target, path),
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    ...(sha ? { sha } : {}),
    ...(maxAttempts ? { maxAttempts } : {}),
  });
  return { sha: res.sha };
}

export async function writeStateBase64({
  octokit,
  owner,
  repo,
  path,
  contentBase64,
  message,
  sha,
  maxAttempts,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  path: string;
  contentBase64: string;
  message: string;
  sha?: string;
  maxAttempts?: number;
}): Promise<{ sha: string | null; path: string; htmlUrl: string | null }> {
  const target = await resolveStateRepo(octokit, owner, repo);
  const targetPath = stateRepoPath(target, path);
  const res = await writeGitHubFileWithRetry(octokit, {
    owner: target.owner,
    repo: target.repo,
    path: targetPath,
    message,
    content: contentBase64,
    ...(sha ? { sha } : {}),
    ...(maxAttempts ? { maxAttempts } : {}),
  });
  return { sha: res.sha, path: targetPath, htmlUrl: res.htmlUrl };
}

export async function writeStateFiles({
  octokit,
  owner,
  repo,
  files,
  message,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  files: StateRepoWriteFile[];
  message: string;
}): Promise<{ sha: string }> {
  if (files.length === 0) {
    throw new Error("No state files to write");
  }

  const target = await resolveStateRepo(octokit, owner, repo);
  const repoInfo = await octokit.repos.get({
    owner: target.owner,
    repo: target.repo,
  });
  const branch = repoInfo.data.default_branch;
  const ref = await octokit.git.getRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${branch}`,
  });
  const baseSha = ref.data.object.sha;
  const baseCommit = await octokit.git.getCommit({
    owner: target.owner,
    repo: target.repo,
    commit_sha: baseSha,
  });
  const tree = await octokit.git.createTree({
    owner: target.owner,
    repo: target.repo,
    base_tree: baseCommit.data.tree.sha,
    tree: files.map((file) => ({
      path: stateRepoPath(target, file.path),
      mode: "100644",
      type: "blob",
      content: file.content,
    })),
  });
  const commit = await octokit.git.createCommit({
    owner: target.owner,
    repo: target.repo,
    message,
    tree: tree.data.sha,
    parents: [baseSha],
  });
  await octokit.git.updateRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });

  return { sha: commit.data.sha };
}

export async function deleteStateFile({
  octokit,
  owner,
  repo,
  path,
  sha,
  message,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  path: string;
  sha: string;
  message: string;
}): Promise<void> {
  const target = await resolveStateRepo(octokit, owner, repo);
  await octokit.repos.deleteFile({
    owner: target.owner,
    repo: target.repo,
    path: stateRepoPath(target, path),
    message,
    sha,
  });
}

export async function deleteStateDirectory({
  octokit,
  owner,
  repo,
  path,
  message,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  path: string;
  message: string;
}): Promise<{ deleted: number }> {
  const target = await resolveStateRepo(octokit, owner, repo);
  const repoInfo = await octokit.repos.get({
    owner: target.owner,
    repo: target.repo,
  });
  const branch = repoInfo.data.default_branch;
  const ref = await octokit.git.getRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${branch}`,
  });
  const baseSha = ref.data.object.sha;
  const baseCommit = await octokit.git.getCommit({
    owner: target.owner,
    repo: target.repo,
    commit_sha: baseSha,
  });
  const currentTree = await octokit.git.getTree({
    owner: target.owner,
    repo: target.repo,
    tree_sha: baseCommit.data.tree.sha,
    recursive: "true",
  });
  if (currentTree.data.truncated) {
    throw new Error("State repo tree is too large to delete safely");
  }

  const prefix = `${stateRepoPath(target, path).replace(/\/+$/g, "")}/`;
  const deletions = currentTree.data.tree
    .filter(
      (entry) =>
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        entry.path.startsWith(prefix),
    )
    .map((entry) => ({
      path: entry.path!,
      mode: "100644" as const,
      type: "blob" as const,
      sha: null,
    }));

  if (deletions.length === 0) return { deleted: 0 };

  const tree = await octokit.git.createTree({
    owner: target.owner,
    repo: target.repo,
    base_tree: baseCommit.data.tree.sha,
    tree: deletions,
  });
  const commit = await octokit.git.createCommit({
    owner: target.owner,
    repo: target.repo,
    message,
    tree: tree.data.sha,
    parents: [baseSha],
  });
  await octokit.git.updateRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });

  return { deleted: deletions.length };
}
