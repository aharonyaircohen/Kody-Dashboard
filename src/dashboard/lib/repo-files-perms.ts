/**
 * @fileType utility
 * @domain files
 * @pattern repo-files-perms
 * @ai-summary Permission guard helpers for the /files page. Determines
 *   whether the current user has read-only or read-write access based on
 *   their token scope.
 */
"use client";

import type { Octokit } from "@octokit/rest";
import type { KodyAuth } from "./auth-context";

export type FilePermission = "read" | "write";

/**
 * Check if the current token has write permission by querying the
 * GitHub API for repository permissions. Fine-grained PATs do not expose
 * scopes in the token itself — we must ask the API.
 *
 * Returns "write" if the token has push or admin permission on the repo,
 * "read" otherwise (including on error — we err on the safe side).
 */
export async function getFilePermission(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<FilePermission> {
  try {
    const res = await octokit.rest.repos.get({ owner, repo });
    const perms = res.data.permissions;
    if (perms?.push || perms?.admin) return "write";
    return "read";
  } catch {
    // On any error (network, rate limit, etc.) conservatively assume read-only.
    return "read";
  }
}

/**
 * Synchronous canWrite stub — kept for backward compatibility with call sites
 * that pass only auth. Those call sites should migrate to getFilePermission
 * which makes a real API call. This stub returns false (read-only) until
 * the async check is implemented per-call-site.
 */
export function canWrite(_auth: KodyAuth | null): boolean {
  return false;
}

export function canRead(auth: KodyAuth | null): boolean {
  return auth !== null;
}
