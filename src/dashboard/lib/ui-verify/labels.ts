/**
 * @fileType utility
 * @domain ui-verify
 * @pattern label-constants
 *
 * PR-level labels for the auto UI-verify gate. Applied to PRs (not issues)
 * because ui-review is PR-scoped. Read by the dashboard to render a ✓/✗
 * badge and (eventually) gate the Review → Done transition.
 *
 *   kody:ui-verified — ui-review ran and verdict was PASS or CONCERNS
 *   kody:ui-failed   — ui-review ran and verdict was FAIL
 *
 * In-flight dedup reuses the engine's existing `kody:reviewing-ui` label
 * (set by ui-review's preflight) — no new in-flight marker needed.
 * (`kody:reviewing` is the plain-review marker; kept in the guard too so
 * a review-family run in flight still blocks re-dispatch.)
 */

export const UI_VERIFIED = "kody:ui-verified";
export const UI_FAILED = "kody:ui-failed";

export const UI_VERIFY_LABEL_META: Record<
  string,
  { color: string; description: string }
> = {
  [UI_VERIFIED]: {
    color: "0e8a16",
    description: "kody ui-review: passed",
  },
  [UI_FAILED]: {
    color: "b60205",
    description: "kody ui-review: failed",
  },
};

/**
 * Labels whose presence on a PR means we should NOT auto-dispatch
 * `@kody ui-review` again. Includes the engine's in-flight marker and
 * both terminal verdict labels.
 */
export const UI_VERIFY_GUARD_LABELS: readonly string[] = [
  UI_VERIFIED,
  UI_FAILED,
  "kody:reviewing-ui",
  "kody:reviewing",
] as const;
