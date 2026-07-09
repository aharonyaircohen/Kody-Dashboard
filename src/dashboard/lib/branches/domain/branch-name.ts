/**
 * @fileType module
 * @domain branches
 * @ai-summary Pure branch-name derivation and parsing. No I/O.
 *
 *   The engine convention (see kody2/src/branch.ts `deriveBranchName`) is
 *   flat `<issueNumber>-<slug>` with no type prefix and no slash. The
 *   dashboard's branch matcher recognises this shape via `^(\d{3,})-` so
 *   issue↔PR linkage works even if the PR body loses its `Closes #N` line.
 */

import { slugifyTitle as slugifySharedTitle } from "@dashboard/lib/slug";

const MAX_SLUG_LENGTH = 40;

export function slugifyTitle(title: string): string {
  return slugifySharedTitle(title, {
    maxLength: MAX_SLUG_LENGTH,
    fallback: "untitled",
    allowUnderscore: false,
  });
}

export function buildBranchName(issueNumber: number, slug: string): string {
  return `${issueNumber}-${slug}`;
}

/**
 * Best-effort parse of an issue number from a branch name. Matches the
 * flat vibe convention (`123-foo-bar`) only — prefixed branches like
 * `fix/123-foo` return null here; that resolution lives in pr-linkage.
 */
export function parseIssueFromBranch(name: string): number | null {
  const match = name.match(/^(\d{3,})-/);
  return match ? Number(match[1]) : null;
}
