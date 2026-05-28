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
