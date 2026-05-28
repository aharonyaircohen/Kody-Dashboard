/**
 * @fileType library
 * @domain previews
 * @pattern config
 *
 * Resolve Fly preview config from the per-repo vault. Follows the
 * per-repo infra rule: each repo's previews are billed against THAT
 * repo's own Fly token, not a global dashboard token.
 *
 * Two entry points:
 *   - `resolvePreviewConfigForOctokit` — call when you already have an
 *     authenticated Octokit (API routes that go through resolveActor or
 *     request-auth wiring).
 *   - `resolvePreviewConfigForRepo` — call from server-side contexts
 *     without a user session (webhook receivers, cron). Uses
 *     KODY_BOT_TOKEN / GITHUB_TOKEN to build a server Octokit.
 */

import { Octokit } from "@octokit/rest";

import { logger } from "@dashboard/lib/logger";
import { readVault } from "@dashboard/lib/vault/store";

import type { FlyPreviewConfig } from "./fly-previews";

export interface ResolvePreviewConfigInput {
  octokit: Octokit;
  owner: string;
  repo: string;
}

async function readVaultMap(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<Record<string, string>> {
  try {
    const { doc } = await readVault(octokit, owner, repo);
    const out: Record<string, string> = {};
    for (const [name, entry] of Object.entries(doc.secrets)) {
      if (entry?.value) out[name] = entry.value;
    }
    return out;
  } catch (err) {
    logger.warn({ err, owner, repo }, "previews: vault read failed");
    return {};
  }
}

export async function resolvePreviewConfigForOctokit(
  input: ResolvePreviewConfigInput,
): Promise<FlyPreviewConfig | null> {
  const secrets = await readVaultMap(input.octokit, input.owner, input.repo);

  const token = secrets.FLY_API_TOKEN ?? process.env.FLY_API_TOKEN ?? "";
  if (!token) return null;

  const orgSlug =
    secrets.FLY_ORG_SLUG ?? process.env.FLY_ORG_SLUG ?? "personal";
  const defaultRegion =
    secrets.FLY_DEFAULT_REGION ?? process.env.FLY_DEFAULT_REGION ?? "fra";

  return { token, orgSlug, defaultRegion };
}

/**
 * Server-side path used by webhook handlers — uses KODY_BOT_TOKEN
 * (preferred) or GITHUB_TOKEN to build the Octokit. The bot token must
 * have repo access to read .kody/secrets.enc.
 */
export async function resolvePreviewConfigForRepo(
  owner: string,
  repo: string,
): Promise<FlyPreviewConfig | null> {
  const auth = process.env.KODY_BOT_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  if (!auth) {
    logger.warn(
      { owner, repo },
      "previews: no KODY_BOT_TOKEN/GITHUB_TOKEN to read vault",
    );
    return null;
  }
  const octokit = new Octokit({ auth });
  return resolvePreviewConfigForOctokit({ octokit, owner, repo });
}
