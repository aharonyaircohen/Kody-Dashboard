/**
 * @fileType module
 * @domain branches
 * @ai-summary Pure ownership check for Kody-created branches.
 *
 *   When `BranchService.getOrCreate` finds an existing branch (the 422
 *   path), we MUST verify the branch belongs to Kody before reusing it.
 *   Without this guard, a pre-existing human branch named `123-foo`
 *   would be silently reused, synced with default, and have a PR opened
 *   on top — clobbering whatever the human was doing.
 *
 *   The marker is the empty seed commit that `createBranchWithMarker`
 *   writes when first creating a Kody branch:
 *
 *       "vibe: start session for #<issueNumber>"
 *
 *   We accept the marker on the branch even if it's no longer the
 *   merge-base (e.g. after a sync that fast-forwarded or merged
 *   default in) — what matters is that some commit unique to the
 *   branch carries the signature.
 */

const MARKER_PATTERN = /^vibe:\s*start session for\s*#?(\d+)\s*$/im;

export function isKodyMarkerCommit(
  message: string,
  issueNumber: number,
): boolean {
  const match = message.match(MARKER_PATTERN);
  if (!match) return false;
  return Number(match[1]) === issueNumber;
}

/**
 * Verify a reused branch is Kody-owned for `issueNumber`. Takes the list
 * of commit messages unique to the branch (i.e. on `branch` but not on
 * its base) — Kody's marker commit will be the oldest of these.
 *
 * Returns `true` only when at least one of those commits matches the
 * marker pattern for this exact issue number. A marker for a different
 * issue does NOT count as ownership — that would mean the slug collided
 * across two unrelated issues.
 */
export function isKodyOwnedBranch(
  uniqueCommitMessages: readonly string[],
  issueNumber: number,
): boolean {
  return uniqueCommitMessages.some((m) => isKodyMarkerCommit(m, issueNumber));
}
