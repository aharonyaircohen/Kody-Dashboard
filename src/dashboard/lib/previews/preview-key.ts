/**
 * @fileType library
 * @domain previews
 * @pattern naming
 * @ai-summary Deterministic Fly app names so (repo, PR) → fixed
 *   hostname, no DB lookup, idempotent rebuilds, easy webhook routing.
 *   Hashes (vs raw names) keep us under Fly's 30-char limit and don't
 *   leak owner / branch names into hostnames.
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
 * A preview serving a single uploaded static file (HTML, PDF, image…).
 * Has no git ref — it's booted from a stock static-server image with the
 * file injected via Fly's machine `files` config, so there's no build and
 * nothing to tear down on a PR/branch event. Created + destroyed manually.
 */
export interface StaticPreviewKey {
  /** owner/name — scopes the Fly app to the repo's own vault token. */
  repo: string;
  /** Opaque id for this upload (no git ref involved). */
  staticId: string;
}

/**
 * Any kind of preview. Discriminated by the presence of `pr` / `branch` /
 * `staticId`, so `previewAppName` (and any consumer) can narrow with
 * `"pr" in key` etc.
 */
export type PreviewKey = PrPreviewKey | BranchPreviewKey | StaticPreviewKey;

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 6);
}

/**
 * Compose the Fly app name:
 *   PR     → `kp-<ownerHash>-<repoHash>-pr-<n>`
 *   branch → `kp-<ownerHash>-<repoHash>-br-<branchHash>`
 *   static → `kp-<ownerHash>-<repoHash>-st-<idHash>`
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
  if ("pr" in key) return `${prefix}-pr-${key.pr}`;
  if ("branch" in key) return `${prefix}-br-${shortHash(key.branch)}`;
  return `${prefix}-st-${shortHash(key.staticId)}`;
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

/**
 * The shared `kp-<ownerHash>-<repoHash>-` prefix every preview app for a repo
 * carries (PR, branch, static, and base). The TTL sweep lists Fly apps and
 * keeps only the ones starting with this prefix so it never touches another
 * repo's — or a non-preview — app.
 */
export function repoPreviewPrefix(repo: string): string {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`invalid repo "${repo}", expected "owner/name"`);
  }
  return `kp-${shortHash(owner)}-${shortHash(name)}-`;
}
