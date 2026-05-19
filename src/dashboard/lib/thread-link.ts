/**
 * @fileType utility
 * @domain kody
 * @pattern dashboard-deep-link
 * @ai-summary Maps a GitHub issue `html_url` to the equivalent in-app
 *   dashboard task route (`/<issueNumber>`) so push notifications open
 *   inside Kody instead of github.com.
 *
 *   Dashboard targets are returned as ROOT-RELATIVE paths (`/123`,
 *   `/messages?...`). They end up in a web-push payload and are resolved
 *   by the service worker against its own registration origin — i.e. the
 *   actually-deployed domain — so this works on every deployment with no
 *   `NEXT_PUBLIC_SERVER_URL` config. Cross-origin github.com URLs (non-
 *   Issue threads) are still returned absolute, unchanged.
 *
 *   Only `Issue` threads have a clean dashboard target — the task page
 *   (`app/[issueNumber]/page.tsx`) is keyed by issue number alone. PRs,
 *   discussions, and commits have no equivalent deep route, so their
 *   GitHub URL is returned unchanged (callers fall back to github.com,
 *   preserving comment anchors there).
 */
import "server-only";

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

  return `/${m[1]}`;
}

/**
 * Dashboard deep link for a messaging-channel comment. Channels are
 * `#`-titled Discussions surfaced in the in-app `/messages` view, so push
 * + inbox entries open the channel scrolled to the message rather than
 * github.com. `c` is the comment's REST `databaseId` — `MessagesView`
 * matches it to scroll/highlight.
 */
export function dashboardChannelUrl(opts: {
  channelNumber: number;
  commentId?: number;
}): string {
  const q = opts.commentId
    ? `?channel=${opts.channelNumber}&c=${opts.commentId}`
    : `?channel=${opts.channelNumber}`;
  return `/messages${q}`;
}
