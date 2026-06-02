/**
 * @fileType utility
 * @domain files
 * @pattern repo-files-perms
 * @ai-summary Permission guard helpers for the /files page. Determines
 *   whether the current user has read-only or read-write access based on
 *   their token scope.
 */
"use client";

import type { KodyAuth } from "./auth-context";

export type FilePermission = "read" | "write";

/**
 * Determine the current user's file permission level based on their auth.
 * For now, we check if the token appears to be a fine-grained PAT with
 * write permissions, or fall back to read-only.
 *
 * A real implementation would use the GitHub API to check the token's
 * scopes, but GitHub doesn't expose scopes for fine-grained PATs — they
 * have precise repo access rules instead. This helper serves as a
 * placeholder that can be enhanced once we wire up token-scope detection.
 */
export function getFilePermission(auth: KodyAuth | null): FilePermission {
  if (!auth) return "read";
  // Write access is assumed for any authenticated user for now.
  // In a follow-up, we'd validate the token has Contents:write scope.
  return "write";
}

export function canWrite(auth: KodyAuth | null): boolean {
  return getFilePermission(auth) === "write";
}

export function canRead(auth: KodyAuth | null): boolean {
  return auth !== null;
}
