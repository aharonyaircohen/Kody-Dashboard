/**
 * @fileType library
 * @domain previews
 * @pattern webhook-handler
 *
 * GitHub webhook entry points for the preview lifecycle. Wired from
 * the `pull_request` event handler in
 * app/api/webhooks/github/route.ts.
 *
 * Two flows:
 *   - opened / synchronize / reopened → handlePrOpenedOrSynced
 *       Builds + boots the preview through the dedicated builder
 *       service. Tries the warm pool first; falls back to create-fresh.
 *   - closed → handlePrClosed
 *       Destroys the per-PR Fly app + machine.
 *
 * Both resolve the Fly token from the TARGET repo's vault, so each
 * repo's previews are billed to that repo. Opt-in is implicit: when
 * the repo's vault has no FLY_API_TOKEN, every handler returns silently.
 */

import { Octokit } from "@octokit/rest";

import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import { logger } from "@dashboard/lib/logger";
import { rebuildBaseImage } from "./base-rebuild";
import { resolvePreviewConfigForRepo } from "./config";
import { createPreview, destroyPreview } from "./preview-lifecycle";

interface PRWebhookEvent {
  repoFullName: string;
  prNumber: number;
}

interface PROpenedOrSyncedEvent extends PRWebhookEvent {
  /** Head SHA the preview should build from (event.pull_request.head.sha). */
  ref: string;
  /** Previous head SHA — only set on `synchronize` (event.before). When
   *  present, the handler asks GitHub which files changed between
   *  before..ref and skips the build if all of them are engine-only. */
  beforeSha?: string;
}

/**
 * Ask GitHub which files changed between two SHAs. Returns null on
 * any failure — callers should fall back to building.
 */
async function fetchChangedPaths(
  owner: string,
  repo: string,
  base: string,
  head: string,
  token: string,
): Promise<string[] | null> {
  try {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`,
    });
    return (data.files ?? []).map((f) => f.filename);
  } catch (err) {
    logger.warn(
      { err, owner, repo, base, head },
      "previews.webhook: compareCommits failed; will not skip",
    );
    return null;
  }
}

export async function handlePrOpenedOrSynced(
  event: PROpenedOrSyncedEvent,
): Promise<void> {
  const [owner, repo] = event.repoFullName.split("/") as [string, string];
  if (!owner || !repo) {
    logger.warn({ event }, "previews.webhook: invalid repo full name");
    return;
  }

  const cfg = await resolvePreviewConfigForRepo(owner, repo);
  if (!cfg) {
    // Repo isn't opted into previews (no FLY_API_TOKEN in vault). No-op.
    return;
  }

  // Sync events with a known `before` SHA → ask GitHub which files
  // changed and skip if the push only touches engine bookkeeping.
  // Same parity as the Vercel `ignoreCommand` policy, but skipped at
  // 0s instead of paying ~21s for a cancelled deploy.
  const bg = await resolveBackgroundToken(owner, repo);
  if (event.beforeSha && bg) {
    const changed = await fetchChangedPaths(
      owner,
      repo,
      event.beforeSha,
      event.ref,
      bg.token,
    );
    if (changed && isEngineOnlyPush(changed)) {
      logger.info(
        {
          repo: event.repoFullName,
          pr: event.prNumber,
          ref: event.ref,
          changedCount: changed.length,
        },
        "previews.webhook: skipping PR build (engine-only push)",
      );
      return;
    }
  }

  try {
    const info = await createPreview(
      {
        repo: event.repoFullName,
        pr: event.prNumber,
        ref: event.ref,
      },
      cfg,
    );
    logger.info(
      {
        repo: event.repoFullName,
        pr: event.prNumber,
        url: info.url,
        builderMachineId: info.builderMachineId,
      },
      "previews.webhook: builder dispatched",
    );
  } catch (err) {
    logger.warn(
      { err, repo: event.repoFullName, pr: event.prNumber },
      "previews.webhook: create failed (non-fatal)",
    );
  }
}

interface DefaultBranchPushEvent {
  repoFullName: string;
  /** Head SHA of the push (event.head_commit.id or after). */
  ref: string;
  /** Paths changed in the push, used to skip engine-only commits. */
  changedPaths: string[];
}

/**
 * Skip base rebuilds when the push only touches engine bookkeeping —
 * matches the Vercel `ignoreCommand` policy on consumer repos so we
 * don't rebuild the base image on every `.kody/**` state write.
 */
function isEngineOnlyPush(changedPaths: string[]): boolean {
  if (changedPaths.length === 0) return false;
  return changedPaths.every(
    (p) => p.startsWith(".kody/") || p === "CHANGELOG.md",
  );
}

export async function handleDefaultBranchPush(
  event: DefaultBranchPushEvent,
): Promise<void> {
  const [owner, repo] = event.repoFullName.split("/") as [string, string];
  if (!owner || !repo) {
    logger.warn({ event }, "previews.webhook: invalid repo full name");
    return;
  }

  if (isEngineOnlyPush(event.changedPaths)) {
    logger.info(
      { repo: event.repoFullName, ref: event.ref },
      "previews.webhook: skipping base rebuild (engine-only push)",
    );
    return;
  }

  const cfg = await resolvePreviewConfigForRepo(owner, repo);
  if (!cfg) {
    // Repo isn't opted into previews (no FLY_API_TOKEN in vault). No-op.
    return;
  }

  // Same background token policy as createPreview — App installation
  // token preferred, vault GITHUB_TOKEN fallback.
  const bg = await resolveBackgroundToken(owner, repo);

  await rebuildBaseImage({
    repo: event.repoFullName,
    ref: event.ref,
    cfg,
    githubToken: bg?.token,
  });
}

export async function handlePrClosed(event: PRWebhookEvent): Promise<void> {
  const [owner, repo] = event.repoFullName.split("/") as [string, string];
  if (!owner || !repo) {
    logger.warn({ event }, "previews.webhook: invalid repo full name");
    return;
  }

  const cfg = await resolvePreviewConfigForRepo(owner, repo);
  if (!cfg) return;

  try {
    await destroyPreview({ repo: event.repoFullName, pr: event.prNumber }, cfg);
    logger.info(
      { repo: event.repoFullName, pr: event.prNumber },
      "previews.webhook: destroyed",
    );
  } catch (err) {
    logger.warn(
      { err, repo: event.repoFullName, pr: event.prNumber },
      "previews.webhook: destroy failed (non-fatal)",
    );
  }
}
