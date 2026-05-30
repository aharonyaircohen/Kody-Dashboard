/**
 * @fileType library
 * @domain previews
 * @pattern vault-read
 *
 * Shared vault read for preview builds. Used by both the per-PR
 * `createPreview` path and the base-image rebuild path so they bake
 * the same secrets + obey the same build-mode toggle.
 *
 * Returns a safe fallback (empty env + prod mode) when the vault is
 * absent, unreadable, or no background token is available. Callers
 * never need to special-case those.
 */

import { Octokit } from "@octokit/rest";

import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import { logger } from "@dashboard/lib/logger";
import { readVault } from "@dashboard/lib/vault/store";

/**
 * Names always stripped before secrets get baked into a preview build.
 * Fly infra credentials (FLY_API_TOKEN, etc.) are server-side only and
 * must never leak into a user-facing image.
 */
export const NEVER_PASS_TO_BUILD: ReadonlySet<string> = new Set([
  "FLY_API_TOKEN",
  "FLY_ORG_SLUG",
  "FLY_DEFAULT_REGION",
  "KODY_MASTER_KEY",
  // Preview-config knob; consumed by the dashboard before spawn, not
  // by the build itself.
  "KODY_PREVIEW_BUILD_MODE",
]);

/** "dev" or "prod" — selects which bundled Dockerfile.preview the
 *  builder uses. Defaults to "prod" because dev mode shifts compile
 *  work to first-request time on the small preview machine, which
 *  for heavy apps (A-Guy: Payload + Sentry + Genkit) is much slower
 *  end-to-end than the build-time compile on Fly's beefier remote
 *  builder. Repos that genuinely benefit from dev mode opt in via
 *  vault secret KODY_PREVIEW_BUILD_MODE = "dev". */
export function parseBuildMode(raw: string | undefined): "dev" | "prod" {
  return raw?.toLowerCase().trim() === "dev" ? "dev" : "prod";
}

export interface VaultBuildContext {
  buildEnv: Record<string, string>;
  buildMode: "dev" | "prod";
}

export async function loadVaultContextForBuild(
  repo: string,
): Promise<VaultBuildContext> {
  const [owner, name] = repo.split("/") as [string, string];
  const fallback: VaultBuildContext = { buildEnv: {}, buildMode: "prod" };
  if (!owner || !name) return fallback;
  const bg = await resolveBackgroundToken(owner, name);
  if (!bg) {
    logger.warn(
      { owner, repo: name },
      "preview: no background token for vault read; build will run with no secrets",
    );
    return fallback;
  }
  try {
    const { doc } = await readVault(
      new Octokit({ auth: bg.token }),
      owner,
      name,
    );
    const buildEnv: Record<string, string> = {};
    for (const [k, entry] of Object.entries(doc.secrets)) {
      if (!entry?.value) continue;
      if (NEVER_PASS_TO_BUILD.has(k)) continue;
      buildEnv[k] = entry.value;
    }
    const buildMode = parseBuildMode(
      doc.secrets.KODY_PREVIEW_BUILD_MODE?.value,
    );
    return { buildEnv, buildMode };
  } catch (err) {
    logger.warn(
      { err, repo },
      "preview: vault read failed; build will run with no secrets",
    );
    return fallback;
  }
}
