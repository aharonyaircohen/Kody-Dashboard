/**
 * @fileType utility
 * @domain ui-verify
 * @pattern folder-root
 *
 * Folder: `ui-verify/` — the auto UI-verification gate for PRs.
 *
 * Two halves: the PR-side trigger (`dispatch.ts` posts `@kody ui-review`
 * so the engine runs ui-review) and the dashboard-side apply (this file
 * + `verdict.ts`, called from the GitHub webhook receiver to translate
 * a `## Verdict:` line in the review comment into a `kody:ui-verified` /
 * `kody:ui-failed` PR label). Module map:
 *   - `labels.ts`   — label constants + the guard set
 *   - `verdict.ts`  — pure parser for `## Verdict: PASS|CONCERNS|FAIL`
 *   - `dispatch.ts` — opt-in trigger for `@kody ui-review`
 *   - this file    — webhook-side verdict → label application
 *
 * This file reads the verdict from a freshly posted kody review comment
 * and applies the corresponding label to the PR:
 *   PASS / CONCERNS → kody:ui-verified
 *   FAIL            → kody:ui-failed
 *
 * Idempotent at the GitHub level — `addLabels` is a no-op if the
 * label is already present.
 *
 * @ai-summary ui-verify/ — the auto UI-verification gate for PRs. This
 *   file is the only currently-wired entry point: the GitHub webhook
 *   route calls `applyVerdictFromComment` on `issue_comment.created` for
 *   comments on issues with a `pull_request` field whose body contains
 *   "Verdict". The trigger half (`dispatch.ts`) is dead code in
 *   production — auto-dispatch on Vercel preview-ready was disabled
 *   after a re-fire loop (the per-PR guard label didn't hold because
 *   SHA changes on every preview sync, jamming the Actions queue).
 *   UI review is now opt-in via the "Request UI review" button in
 *   PreviewActions. Trap: don't re-enable dispatch from the webhook
 *   without SHA/preview-URL-keyed dedup — the label guard alone will
 *   not save you.
 */

import { addLabels, ensureLabel } from "../github-client";
import { logger } from "../logger";
import { UI_VERIFIED, UI_FAILED, UI_VERIFY_LABEL_META } from "./labels";
import { parseVerdict, verdictToLabel } from "./verdict";

export interface ApplyLabelResult {
  applied: boolean;
  label?: typeof UI_VERIFIED | typeof UI_FAILED;
  reason: string;
}

export async function applyVerdictFromComment(
  prNumber: number,
  body: string,
): Promise<ApplyLabelResult> {
  const verdict = parseVerdict(body);
  if (!verdict) {
    return { applied: false, reason: "no verdict marker in body" };
  }

  const label = verdictToLabel(verdict);

  try {
    await ensureLabel(label, UI_VERIFY_LABEL_META[label]);
    await addLabels(prNumber, [label]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      {
        event: "ui_verify_label_apply_failed",
        pr: prNumber,
        label,
        error: msg,
      },
      "ui-verify: failed to apply verdict label",
    );
    return { applied: false, reason: `apply failed: ${msg}` };
  }

  logger.info(
    { event: "ui_verify_label_applied", pr: prNumber, label, verdict },
    "Applied UI-verify verdict label",
  );
  return { applied: true, label, reason: "ok" };
}
