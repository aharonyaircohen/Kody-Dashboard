/**
 * @fileType utility
 * @domain ui-verify
 * @pattern parser
 *
 * Pure parser for ui-review's verdict marker. The engine's `ui-review`
 * executable always emits a `## Verdict: PASS|CONCERNS|FAIL` line in
 * the review comment it posts on the PR (see kody2/src/scripts/
 * postReviewResult.ts). This module is the dashboard-side reader.
 *
 * Mapping to labels:
 *   PASS, CONCERNS → kody:ui-verified  (advisory issues don't block)
 *   FAIL           → kody:ui-failed
 */

import { UI_VERIFIED, UI_FAILED } from "./labels";

export type UiVerdict = "PASS" | "CONCERNS" | "FAIL";

const VERDICT_RE = /##\s*Verdict\s*:\s*(PASS|CONCERNS|FAIL)\b/i;

export function parseVerdict(body: string): UiVerdict | null {
  const m = body.match(VERDICT_RE);
  if (!m) return null;
  return m[1]!.toUpperCase() as UiVerdict;
}

export function verdictToLabel(
  verdict: UiVerdict,
): typeof UI_VERIFIED | typeof UI_FAILED {
  return verdict === "FAIL" ? UI_FAILED : UI_VERIFIED;
}
