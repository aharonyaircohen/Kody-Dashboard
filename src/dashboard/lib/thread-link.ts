/**
 * @fileType utility
 * @domain kody
 * @pattern dashboard-deep-link
 * @ai-summary Maps a GitHub issue `html_url` to the equivalent in-app
 *   dashboard task route (`/<issueNumber>`) so push notifications open
 *   inside Kody instead of github.com.
 *
 *   Only `Issue` threads have a clean dashboard target — the task page
 *   (`app/[issueNumber]/page.tsx`) is keyed by issue number alone. PRs,
 *   discussions, and commits have no equivalent deep route, so their
 *   GitHub URL is returned unchanged (callers fall back to github.com,
 *   preserving comment anchors there).
 */
import "server-only";
import { getPublicBaseUrl } from "./auth/oauth-url";

// Matches the issue number in a GitHub issue/issue-comment html_url, e.g.
// https://github.com/owner/repo/issues/123 or .../issues/123#issuecomment-456
const ISSUE_PATH_RE = /\/issues\/(\d+)(?:[#?].*)?$/;

/**
 * Return the dashboard URL for an `Issue` thread, or the original GitHub
 * URL for any other thread type (or when the URL shape is unexpected).
 */
export function dashboardThreadUrl(opts: {
  githubUrl: string | undefined;
  threadType: string;
}): string {
  const githubUrl = opts.githubUrl ?? "";
  if (opts.threadType !== "Issue") return githubUrl;

  const m = githubUrl.match(ISSUE_PATH_RE);
  if (!m) return githubUrl;

  const base = getPublicBaseUrl().replace(/\/+$/, "");
  return `${base}/${m[1]}`;
}
