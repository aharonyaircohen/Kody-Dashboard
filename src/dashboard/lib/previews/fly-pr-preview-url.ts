/**
 * @fileType library
 * @domain previews
 * @pattern fly-url-resolver
 *
 * Resolve the deterministic Fly preview URL for a PR — but only when the
 * repo actually has Fly previews configured AND a per-PR app exists. Returns
 * `null` for every "not on Fly" case (no Fly token in the repo vault, no app
 * built yet, or any Fly API hiccup), which is the caller's signal to fall
 * back to the Vercel preview lookup. Best-effort: it never throws, so a Fly
 * outage degrades to Vercel rather than blanking the preview pane.
 */

import type { Octokit } from "@octokit/rest";

import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
import { getPreview } from "@dashboard/lib/previews/preview-lifecycle";

/**
 * @returns the `https://<app>.fly.dev` URL when the repo has a Fly token and
 *   the per-PR preview app exists; `null` otherwise (→ fall back to Vercel).
 */
export async function flyPrPreviewUrl(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<string | null> {
  try {
    // No Fly token in this repo's vault → previews never built on Fly here.
    const cfg = await resolvePreviewConfigForOctokit({ octokit, owner, repo });
    if (!cfg) return null;

    // App missing → getPreview returns null (no preview built for this PR yet).
    const info = await getPreview({ repo: `${owner}/${repo}`, pr }, cfg);
    return info?.url ?? null;
  } catch (err) {
    logger.warn(
      { err, owner, repo, pr },
      "fly preview url lookup failed; falling back to Vercel",
    );
    return null;
  }
}
