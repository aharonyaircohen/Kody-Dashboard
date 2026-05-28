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

import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForRepo } from "./config";
import { createPreview, destroyPreview } from "./preview-lifecycle";

interface PRWebhookEvent {
  repoFullName: string;
  prNumber: number;
}

interface PROpenedOrSyncedEvent extends PRWebhookEvent {
  /** Head SHA the preview should build from (event.pull_request.head.sha). */
  ref: string;
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
        source: info.source,
        buildMs: info.buildMs,
      },
      "previews.webhook: created",
    );
  } catch (err) {
    logger.warn(
      { err, repo: event.repoFullName, pr: event.prNumber },
      "previews.webhook: create failed (non-fatal)",
    );
  }
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
    await destroyPreview(
      { repo: event.repoFullName, pr: event.prNumber },
      cfg,
    );
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
