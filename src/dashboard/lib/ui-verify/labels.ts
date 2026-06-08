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
 *
 * @ai-summary The two terminal verdict labels and the guard set that
 *   blocks re-dispatch. Constants are imported by UIVerifyBadge and the
 *   activity bucketer (`src/dashboard/lib/activity/action.ts`) — don't
 *   rename without updating those. The guard set includes
 *   `kody:reviewing-ui` (set by the engine's ui-review preflight, NOT
 *   by anything in this repo) and `kody:reviewing` (the plain-review
 *   marker; included intentionally so a review-family run in flight
 *   also blocks ui-review re-dispatch). Trap: `kody:reviewing-ui` is
 *   engine-owned — if its name changes upstream, this guard silently
 *   stops blocking and re-dispatch can fire.
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
