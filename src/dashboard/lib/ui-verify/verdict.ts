/**
 * @fileType utility
 * @domain ui-verify
 * @pattern parser
 *
 * Pure parser for ui-review's verdict marker. The engine's `ui-review`
 * agentAction always emits a `## Verdict: PASS|CONCERNS|FAIL` line in
 * the review comment it posts on the PR (see kody2/src/scripts/
 * postReviewResult.ts). This module is the dashboard-side reader.
 *
 * Mapping to labels:
 *   PASS, CONCERNS → kody:ui-verified  (advisory issues don't block)
 *   FAIL           → kody:ui-failed
 *
 * @ai-summary Pure parser for the engine's `## Verdict: PASS|CONCERNS|FAIL`
 *   line. No I/O, no side effects — the caller (`apply-label.ts`) does
 *   the GitHub work. The regex is intentionally case-insensitive on the
 *   verdict token; the engine always emits uppercase, so the explicit
 *   `.toUpperCase()` on match is defensive, not load-bearing. Trap: the
 *   webhook route prefilters on the substring "Verdict" before calling
 *   the parser, so don't tighten the regex so far that it rejects
 *   engine comments with extra whitespace or different casing — the
 *   substring check is the cheap outer guard, the regex is the
 *   structured extraction.
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
