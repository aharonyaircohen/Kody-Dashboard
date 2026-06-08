/**
 * @fileType library
 * @domain previews
 * @pattern config
 * @ai-summary Resolves the per-repo Fly token / org / region used for every
 *   Fly API call in the preview system. Trap: this is the per-repo billing
 *   gate — never accept a token from a global source (Vercel env,
 *   `process.env.FLY_API_TOKEN` only) as the sole path. A repo with no
 *   vault token gets `null` back, which is the universal "this repo is not
 *   opted into previews" signal; webhook handlers depend on that signal
 *   to no-op.
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

import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import {
  getEngineConfig,
  resolveFlyPreviews,
  type ResolvedFlyPreviews,
} from "@dashboard/lib/engine/config";
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

  const token =
    secrets.FLY_API_TOKEN ??
    process.env.FLY_API_TOKEN ??
    process.env.FLY_IO_TOKEN ??
    "";
  if (!token) return null;

  const orgSlug =
    secrets.FLY_ORG_SLUG ?? process.env.FLY_ORG_SLUG ?? "personal";
  const defaultRegion =
    secrets.FLY_DEFAULT_REGION ?? process.env.FLY_DEFAULT_REGION ?? "fra";

  return { token, orgSlug, defaultRegion };
}

/**
 * Server-side path used by webhook handlers and other unattended
 * background work. Resolves a token via the shared background-token
 * policy: GitHub App installation token preferred, vault GITHUB_TOKEN
 * fallback. Matches the rest of the dashboard's webhook fan-out so the
 * App-vs-vault decision lives in one place.
 */
export async function resolvePreviewConfigForRepo(
  owner: string,
  repo: string,
): Promise<FlyPreviewConfig | null> {
  const bg = await resolveBackgroundToken(owner, repo);
  if (!bg) {
    logger.warn(
      { owner, repo },
      "previews: no background token (App not installed and vault GITHUB_TOKEN missing)",
    );
    return null;
  }
  const octokit = new Octokit({ auth: bg.token });
  return resolvePreviewConfigForOctokit({ octokit, owner, repo });
}

/**
 * Resolve the per-repo preview machine knobs (size, idle-suspend,
 * health-check, TTL) from kody.config.json's `fly.previews` block. Falls
 * back to {@link DEFAULT_FLY_PREVIEWS} for any unset field, and to the full
 * defaults if the repo has no config / can't be read. Never throws — the
 * preview hot path must not break on a config read.
 *
 * `githubToken`, when supplied by the webhook handler, reuses the
 * already-resolved background token (one fewer GitHub call); otherwise we
 * resolve one via the shared background-token policy.
 */
export async function resolveFlyPreviewsForRepo(
  repo: string,
  githubToken?: string,
): Promise<ResolvedFlyPreviews> {
  const [owner, name] = repo.split("/");
  if (!owner || !name)
    return resolveFlyPreviews({ executables: { default: "run" } });
  try {
    let token = githubToken;
    if (!token) {
      const bg = await resolveBackgroundToken(owner, name);
      token = bg?.token;
    }
    if (!token) return resolveFlyPreviews({ executables: { default: "run" } });
    const octokit = new Octokit({ auth: token });
    const { config } = await getEngineConfig(octokit, owner, name);
    return resolveFlyPreviews(config);
  } catch (err) {
    logger.warn(
      { err, repo },
      "previews: fly-config read failed, using defaults",
    );
    return resolveFlyPreviews({ executables: { default: "run" } });
  }
}
