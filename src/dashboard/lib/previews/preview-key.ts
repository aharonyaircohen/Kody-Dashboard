/**
 * @fileType library
 * @domain previews
 * @pattern naming
 *
 * Deterministic app naming for previews. Same (repo, PR) always yields
 * the same Fly app name, which means the public URL is deterministic too
 * — no DB lookup, idempotent rebuilds, easy webhook routing.
 */

import { createHash } from "node:crypto";

/** A preview tied to a pull request — auto-built and torn down on PR events. */
export interface PrPreviewKey {
  /** owner/name */
  repo: string;
  pr: number;
}

/** A preview tied to a bare branch — created and destroyed manually. */
export interface BranchPreviewKey {
  /** owner/name */
  repo: string;
  branch: string;
}

/**
 * Either kind of preview. Discriminated by the presence of `pr` vs `branch`,
 * so `previewAppName` (and any consumer) can narrow with `"pr" in key`.
 */
export type PreviewKey = PrPreviewKey | BranchPreviewKey;

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 6);
}

/**
 * Compose the Fly app name:
 *   PR     → `kp-<ownerHash>-<repoHash>-pr-<n>`
 *   branch → `kp-<ownerHash>-<repoHash>-br-<branchHash>`
 *
 * The `kp-` prefix namespaces all kody-previews apps in the Fly org so
 * the warm pool, ops dashboards, and ad-hoc cleanups can match on it.
 * Hashes (vs raw names) keep us under Fly's 30-char limit, don't leak
 * owner names into hostnames, and make any branch name safe to encode.
 */
export function previewAppName(key: PreviewKey): string {
  const [owner, name] = key.repo.split("/");
  if (!owner || !name) {
    throw new Error(`invalid repo "${key.repo}", expected "owner/name"`);
  }
  const prefix = `kp-${shortHash(owner)}-${shortHash(name)}`;
  return "pr" in key
    ? `${prefix}-pr-${key.pr}`
    : `${prefix}-br-${shortHash(key.branch)}`;
}

/**
 * Compose the Fly app name for the per-repo BASE image:
 * `kp-<ownerHash>-<repoHash>-base`.
 *
 * The base image holds the heavy install + build cache so per-PR
 * builds can `FROM` it and skip dependency install. The builder
 * detects this name shape (suffix `-base`) and mirrors the resulting
 * image to GHCR so per-PR builds (which run under flyctl
 * `--remote-only` and can't auth to the Fly registry) can inherit
 * from it without any auth.
 */
export function basePreviewAppName(repo: string): string {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`invalid repo "${repo}", expected "owner/name"`);
  }
  return `kp-${shortHash(owner)}-${shortHash(name)}-base`;
}
