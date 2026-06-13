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

const MAX_SLUG_LENGTH = 40;

export function slugifyTitle(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  return cleaned || "untitled";
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
