/**
 * @fileType utility
 * @domain kody
 * @pattern state-repo
 * @ai-summary Resolves and accesses the external Kody runtime-state repo for
 *   the connected consumer repo. Runtime files live under
 *   `<state.path>/<relative-file>` in `state.repo`, not through the consumer repo.
 */

import type { Octokit } from "@octokit/rest";
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

export interface StateRepoEntry {
  name: string;
  path: string;
  type: string;
  size?: number;
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
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
}): Promise<{ sha: string | null }> {
  const target = await resolveStateRepo(octokit, owner, repo);
  const res = await octokit.repos.createOrUpdateFileContents({
    owner: target.owner,
    repo: target.repo,
    path: stateRepoPath(target, path),
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    ...(sha ? { sha } : {}),
  });
  return { sha: res.data.content?.sha ?? null };
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
