/**
 * @fileType utility
 * @domain ui-verify
 * @pattern webhook-action
 *
 * Idempotent dispatcher for `@kody ui-review`. Called from the GitHub
 * webhook receiver when a Vercel preview deployment reports success.
 * Comments `@kody ui-review` on the PR, which the engine's kody.yml
 * dispatcher picks up and runs.
 *
 * Idempotency: skip if the PR already carries any UI-verify guard
 * label (kody:ui-verified / kody:ui-failed / kody:reviewing-ui /
 * kody:reviewing). The `kody:reviewing-ui` check is the in-flight
 * marker — set by ui-review's preflight (`setLifecycleLabel`).
 *
 * @ai-summary The trigger half of ui-verify/: posts `@kody ui-review` on
 *   a PR so the engine's kody.yml dispatcher picks it up and runs the
 *   ui-review implementation. This module is currently dead code in
 *   production — the webhook route's `check_run` handler stopped
 *   auto-dispatching after a re-fire loop: with auto-sync re-pushing
 *   ~30 open PRs every cycle, each rebuild produced a fresh
 *   preview-ready check, so this re-fired endlessly (984 comments
 *   observed) and jammed the Actions queue. The per-PR guard label
 *   didn't hold because the SHA changes on every sync. UI review is
 *   now opt-in only via the "Request UI review" button in
 *   PreviewActions. Trap: if you re-enable auto-dispatch, the label
 *   guard here is not enough — you also need SHA/preview-URL-keyed
 *   dedup, otherwise a single PR rebuild triggers a fresh run every
 *   time.
 */

import { fetchIssue, postComment } from "../github-client";
import { logger } from "../logger";
import { UI_VERIFY_GUARD_LABELS } from "./labels";

const DISPATCH_COMMAND = "@kody ui-review";

export interface DispatchResult {
  dispatched: boolean;
  reason: string;
}

export async function maybeDispatchUiReview(
  prNumber: number,
): Promise<DispatchResult> {
  let pr;
  try {
    pr = await fetchIssue(prNumber);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { event: "ui_verify_dispatch_fetch_failed", pr: prNumber, error: msg },
      "ui-verify dispatch: failed to fetch PR — skipping",
    );
    return { dispatched: false, reason: `fetch failed: ${msg}` };
  }

  if (!pr) {
    return { dispatched: false, reason: "pr not found" };
  }

  const labelNames = pr.labels.map((l) => l.name);
  const existingGuard = UI_VERIFY_GUARD_LABELS.find((g) =>
    labelNames.includes(g),
  );
  if (existingGuard) {
    return {
      dispatched: false,
      reason: `already has guard label: ${existingGuard}`,
    };
  }

  try {
    await postComment(prNumber, DISPATCH_COMMAND);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: "ui_verify_dispatch_comment_failed", pr: prNumber, error: msg },
      "ui-verify dispatch: failed to post @kody ui-review comment",
    );
    return { dispatched: false, reason: `comment failed: ${msg}` };
  }

  logger.info(
    { event: "ui_verify_dispatched", pr: prNumber },
    "Auto-dispatched @kody ui-review on Vercel preview ready",
  );
  return { dispatched: true, reason: "ok" };
}
