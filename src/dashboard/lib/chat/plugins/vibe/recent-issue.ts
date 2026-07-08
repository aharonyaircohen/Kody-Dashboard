/**
 * @fileType utility
 * @domain vibe
 * @ai-summary Decide which issue number a kody-direct chat turn should attach
 *   to, bridging the gap right after a vibe issue is created.
 *
 *   The bug this closes: in the two-turn vibe flow (turn 1 creates the issue,
 *   turn 2 approves/executes it), the page navigates to the new issue but the
 *   chat's task scope (`context.kind === "task"`) doesn't always propagate
 *   before the user sends turn 2. When it hasn't, the request carries no task
 *   scope, the server can't bind the hand-off to the right issue, and the
 *   model's (sometimes wrong/guessed) issue number goes through unchecked.
 *
 *   Fix: the chat remembers the issue it JUST created and, until the real
 *   task scope catches up (or a short TTL elapses), uses it as the request's
 *   issue. A live, resolved task scope always wins; the remembered issue is
 *   only a fallback, and only in vibe mode.
 */

/** Default window the remembered issue stays valid for (ms). */
export const RECENT_VIBE_ISSUE_TTL_MS = 60_000;

export interface RecentVibeIssue {
  issueNumber: number;
  /** Local ms when the issue was created (drives the TTL). */
  at: number;
}

export function pickVibeRequestIssueNumber(opts: {
  /** Issue number from the live, resolved task scope (null if unscoped). */
  selectedTaskIssueNumber: number | null;
  vibeMode: boolean;
  recent: RecentVibeIssue | null;
  nowMs: number;
  maxAgeMs?: number;
}): number | null {
  // A live, resolved task scope is always authoritative.
  if (opts.selectedTaskIssueNumber != null) return opts.selectedTaskIssueNumber;
  // Otherwise, bridge with the just-created issue — vibe only, within TTL.
  if (
    opts.vibeMode &&
    opts.recent &&
    opts.nowMs - opts.recent.at <= (opts.maxAgeMs ?? RECENT_VIBE_ISSUE_TTL_MS)
  ) {
    return opts.recent.issueNumber;
  }
  return null;
}
