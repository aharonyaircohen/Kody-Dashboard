/**
 * @fileType utility
 * @domain ui-verify
 * @pattern webhook-action
 *
 * Reads the verdict from a freshly posted kody review comment and
 * applies the corresponding label to the PR:
 *   PASS / CONCERNS → kody:ui-verified
 *   FAIL            → kody:ui-failed
 *
 * Idempotent at the GitHub level — `addLabels` is a no-op if the
 * label is already present.
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
