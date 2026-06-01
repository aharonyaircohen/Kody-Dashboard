/**
 * @fileType utility
 * @domain kody
 * @pattern repo-files-perms
 * @ai-summary Permission guards for the file browser.
 *   Write operations are only available when the user has a valid GitHub token.
 *   Read operations are available to any authenticated user.
 */

import { getStoredAuth } from "./api";

/**
 * Check if the current user has write access to the repo.
 * Write access requires a valid GitHub token (read from localStorage auth).
 *
 * Note: In a real implementation, you might want to verify the token has
 * the necessary scopes (repo scope for read/write). For now, we assume
 * any stored token can write.
 */
export function canWrite(): boolean {
  const auth = getStoredAuth();
  return !!auth?.token;
}

/**
 * Check if the current user has read access to the repo.
 * Any authenticated user (with a stored auth) can read.
 */
export function canRead(): boolean {
  const auth = getStoredAuth();
  return !!auth?.token;
}

/**
 * Get the tooltip message for disabled write actions.
 */
export function writeTooltip(): string {
  if (!canRead()) {
    return "Connect a repository to access files";
  }
  if (!canWrite()) {
    return "Read-only access — no write token available";
  }
  return "";
}

/**
 * Check if write operations should be disabled.
 */
export function isReadOnly(): boolean {
  return !canWrite();
}
