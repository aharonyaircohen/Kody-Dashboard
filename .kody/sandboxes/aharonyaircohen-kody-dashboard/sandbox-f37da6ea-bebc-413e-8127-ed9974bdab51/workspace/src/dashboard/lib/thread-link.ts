/**
 * @fileType utility
 * @domain kody
 * @pattern dashboard-deep-link
 * @ai-summary Maps a GitHub issue/PR `html_url` to the equivalent in-app
 *   dashboard task route (`/<number>`) so push notifications open inside
 *   Kody instead of github.com.
 *
 *   Dashboard targets are returned as ROOT-RELATIVE paths (`/123`,
 *   `/messages?...`). They end up in a web-push payload and are resolved
 *   by the service worker against its own registration origin — i.e. the
 *   actually-deployed domain — so this works on every deployment with no
 *   `NEXT_PUBLIC_SERVER_URL` config. Cross-origin github.com URLs (with
 *   no clean dashboard mapping) are still returned absolute, unchanged.
 *
 *   Issues and PRs share the dashboard task page (`app/[issueNumber]/
 *   page.tsx`) because GitHub uses a shared number pool for both — the
 *   page renders whichever artifact owns that number. Discussion and
 *   commit URLs have no equivalent dashboard route, so their GitHub URL
 *   is returned unchanged (callers fall back to github.com, preserving
 *   anchors there).
 */
import "server-only";

// Matches the issue/PR number in a GitHub html_url. Covers:
//   https://github.com/owner/repo/issues/123
//   https://github.com/owner/repo/issues/123#issuecomment-456
//   https://github.com/owner/repo/pull/123
//   https://github.com/owner/repo/pull/123#issuecomment-456
//   https://github.com/owner/repo/pull/123#discussion_r789
//   https://github.com/owner/repo/pull/123#pullrequestreview-789
const TASK_PATH_RE = /\/(?:issues|pull)\/(\d+)(?:[#?/].*)?$/;

/**
 * Return the dashboard URL for an Issue/PR thread, or the original GitHub
 * URL for thread types with no in-app view (Discussion, Commit) or when
 * the URL shape is unexpected.
 */
export function dashboardThreadUrl(opts: {
  githubUrl: string | undefined;
  threadType: string;
}): string {
  const githubUrl = opts.githubUrl ?? "";
  if (opts.threadType !== "Issue" && opts.threadType !== "PullRequest") {
    return githubUrl;
  }

  const m = githubUrl.match(TASK_PATH_RE);
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
