/**
 * @fileType library
 * @domain previews
 * @pattern vault-read
 * @ai-summary Shared vault read for preview builds. Used by both the
 *   per-PR `createPreview` path and the base-image rebuild path so they
 *   bake the same secrets + obey the same build-mode toggle.
 *
 *   Trap: a safe fallback (empty env + prod mode) is returned when the
 *   vault is absent, unreadable, or no background token is available.
 *   Callers never need to special-case those — but those silent
 *   fall-throughs (empty env → broken build) used to be invisible. The
 *   three failure modes (no token at all, vault read failed, vault
 *   returned 0 secrets) are now distinguished via loud `logger.error`
 *   paths so the empty-vault case stops being a mystery. `NEVER_PASS_TO_BUILD`
 *   is the load-bearing allowlist: it strips infra-only keys (Fly token,
 *   master key, build-mode knob) so they never get baked into a
 *   user-facing image.
 */

import { Octokit } from "@octokit/rest";

import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import { logger } from "@dashboard/lib/logger";
import { readVault } from "@dashboard/lib/vault/store";

/**
 * Empty fallback. Returned only when the vault is genuinely unreadable
 * (no token, no `.kody/secrets.enc`, decrypt failure). When a token is
 * passed in but the read fails, the caller decides whether to proceed.
 */
const EMPTY: VaultBuildContext = { buildEnv: {}, buildMode: "prod" };

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

/**
 * Read the per-repo vault and return the build env + build mode.
 *
 * When `token` is supplied, it's used directly (no second background-token
 * resolve). Callers that already resolved a background token at the
 * webhook layer SHOULD pass it in — this both eliminates a redundant
 * GitHub call and ensures the same token that worked for sibling
 * vault reads is reused here.
 *
 * Distinguishes three failure modes via the loud `logger.error` paths so
 * silent fall-throughs (empty env → broken build) stop being a mystery:
 *
 *   - no token available at all (vault + App both empty)
 *   - vault read failed (404, decrypt error, network)
 *   - vault read returned 0 secrets (real empty vault)
 */
export async function loadVaultContextForBuild(
  repo: string,
  token?: string,
): Promise<VaultBuildContext> {
  const [owner, name] = repo.split("/") as [string, string];
  if (!owner || !name) {
    logger.error(
      { repo },
      "preview: invalid repo full name; cannot read vault",
    );
    return EMPTY;
  }

  let resolvedToken = token;
  if (!resolvedToken) {
    const bg = await resolveBackgroundToken(owner, name);
    if (!bg) {
      logger.error(
        { owner, repo: name },
        "preview: no background token for vault read — build will run with no secrets",
      );
      return EMPTY;
    }
    resolvedToken = bg.token;
  }

  let doc;
  try {
    const result = await readVault(
      new Octokit({ auth: resolvedToken }),
      owner,
      name,
    );
    doc = result.doc;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), repo },
      "preview: vault read FAILED — build will run with no secrets",
    );
    return EMPTY;
  }

  const buildEnv: Record<string, string> = {};
  for (const [k, entry] of Object.entries(doc.secrets ?? {})) {
    if (!entry?.value) continue;
    if (NEVER_PASS_TO_BUILD.has(k)) continue;
    buildEnv[k] = entry.value;
  }
  if (Object.keys(buildEnv).length === 0) {
    logger.error(
      { repo, totalSecrets: Object.keys(doc.secrets ?? {}).length },
      "preview: vault has no buildable secrets — build will run with no secrets",
    );
  }
  const buildMode = parseBuildMode(doc.secrets?.KODY_PREVIEW_BUILD_MODE?.value);
  return { buildEnv, buildMode };
}
