/**
 * @fileType library
 * @domain previews
 * @pattern webhook-handler
 *
 * GitHub webhook entry point for preview lifecycle. Wired from the
 * pull_request handler in app/api/webhooks/github/route.ts.
 *
 * Why only `closed`: open/sync/reopened need a built image, and only CI
 * has the build context. CI calls POST /api/kody/previews directly once
 * the image is pushed. The webhook handles `closed` because no build is
 * needed to tear down — and the dashboard is the only thing watching
 * lifecycle events.
 */

import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForRepo } from "./config";
import { destroyPreview } from "./preview-lifecycle";

interface PRClosedEvent {
  repoFullName: string;
  prNumber: number;
}

export async function handlePrClosed(event: PRClosedEvent): Promise<void> {
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
