/**
 * @fileType utility
 * @domain kody
 * @pattern inbox-deep-link
 * @ai-summary Shareable dashboard deep links to a thread the inbox can open
 *   inline. The inbox itself is per-user/private (one gist per user), so an
 *   "inbox item" link can't point at the entry — it points at the *thread*
 *   the entry is about (`owner/repo` issue/PR/discussion), which anyone with
 *   that repo connected + dashboard access can open. The link carries only
 *   `?thread=<Type>:<number>`; the connected repo comes from the viewer's
 *   own auth, so the URL stays repo-agnostic and short.
 *
 *   `buildSyntheticInboxEntry` produces an InboxEntry-shaped object good
 *   enough for `InboxThreadDialog` / `resolvableThread` (they only read
 *   `threadType` / `repoFullName` / `url` / `title`) without the entry ever
 *   existing in anyone's gist — that's the whole point of a thread link.
 */
import type { InboxEntry } from "./types";

export const INBOX_THREAD_PARAM = "thread";

/** Thread types the inbox can render inline (mirror of resolvableThread). */
export type DeepLinkType = "Issue" | "PullRequest" | "Discussion";

const TYPE_TO_PATH: Record<DeepLinkType, string> = {
  Issue: "issues",
  PullRequest: "pull",
  Discussion: "discussions",
};

const TYPES = Object.keys(TYPE_TO_PATH) as DeepLinkType[];

export interface ParsedThreadLink {
  type: DeepLinkType;
  number: number;
}

/**
 * Parse a `?thread=` value (`"Issue:123"`). Returns null on any malformed
 * input — callers treat null as "no deep link", never as an error.
 */
export function parseThreadParam(
  value: string | null | undefined,
): ParsedThreadLink | null {
  if (!value) return null;
  const [rawType, rawNum] = value.split(":");
  const type = TYPES.find((t) => t === rawType);
  if (!type) return null;
  const number = Number(rawNum);
  if (!Number.isInteger(number) || number <= 0) return null;
  return { type, number };
}

/** Inverse of parseThreadParam — the value half of the share URL. */
export function serializeThreadParam(
  type: DeepLinkType,
  number: number,
): string {
  return `${type}:${number}`;
}

/**
 * Absolute, shareable dashboard URL that opens this thread inline.
 * `origin` is the deployment origin (e.g. `window.location.origin`).
 */
export function buildThreadShareLink(
  origin: string,
  type: DeepLinkType,
  number: number,
): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/inbox?${INBOX_THREAD_PARAM}=${serializeThreadParam(type, number)}`;
}

/**
 * A throwaway InboxEntry for a deep-linked thread that is not (and need not
 * be) in the viewer's gist. The `url` is built so `resolvableThread`'s
 * `/(issues|pull|discussions)/(\d+)/` regex matches; the dialog uses it only
 * as the "Open on GitHub" fallback.
 */
export function buildSyntheticInboxEntry(
  repoFullName: string,
  type: DeepLinkType,
  number: number,
): InboxEntry {
  return {
    id: `deep-link:${type}:${number}`,
    source: "other",
    repoFullName,
    threadType: type,
    title: `${type === "PullRequest" ? "PR" : type} #${number}`,
    snippet: "",
    url: `https://github.com/${repoFullName}/${TYPE_TO_PATH[type]}/${number}`,
    sentAt: new Date(0).toISOString(),
    readAt: new Date(0).toISOString(),
  };
}
