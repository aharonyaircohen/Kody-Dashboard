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

export interface PreviewKey {
  /** owner/name */
  repo: string;
  pr: number;
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 6);
}

/**
 * Compose the Fly app name: `kp-<ownerHash>-<repoHash>-pr-<n>`.
 *
 * The `kp-` prefix namespaces all kody-previews apps in the Fly org so
 * the warm pool, ops dashboards, and ad-hoc cleanups can match on it.
 * Hashes (vs raw names) keep us under Fly's 30-char limit and don't
 * leak owner names into hostnames.
 */
export function previewAppName(key: PreviewKey): string {
  const [owner, name] = key.repo.split("/");
  if (!owner || !name) {
    throw new Error(`invalid repo "${key.repo}", expected "owner/name"`);
  }
  return `kp-${shortHash(owner)}-${shortHash(name)}-pr-${key.pr}`;
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
