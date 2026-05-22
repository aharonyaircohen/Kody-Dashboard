/**
 * @fileType utility
 * @domain kody
 * @pattern cto-backpressure-gate
 * @ai-summary Code-enforced cap on **pending** CTO recommendations in the
 *   inbox. The `cto.md` staff member is told to stop at 10, but that is prose an
 *   LLM re-counts every tick from a ledger — it drifts and over-posts. This
 *   module makes the cap deterministic at the one server-side write point
 *   (the webhook → inbox-feed append): a CTO recommendation entry is only
 *   admitted while fewer than `MAX_PENDING_CTO_RECS` are still undecided.
 *
 *   "Pending" = a feed entry that is a CTO recommendation (`ctoAction` set,
 *   resolvable to an issue number) whose `(taskNumber, action)` has no
 *   verdict in the `kody:cto-decisions` ledger. Once the operator
 *   approves/rejects, that slot frees and later recommendations flow again.
 *
 *   Non-CTO mentions are never gated — only CTO recommendation entries count
 *   against, and are limited by, the cap.
 */
import type { InboxFeedEntry } from "../inbox/feed";
import { ctoDecisionKey, type CtoLatestDecision } from "./decisions";

/**
 * Hard ceiling on undecided CTO recommendations visible in the inbox at
 * once. Mirrors the "at most 10 pending" rule in `.kody/staff/cto.md`,
 * but enforced here so it actually holds.
 */
export const MAX_PENDING_CTO_RECS = 10;

/** Pull `123` out of a `.../issues/123` (or `#…`) url. */
function issueNumberFromUrl(url: string): number | null {
  const m = url.match(/\/issues\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The `(taskNumber, action)` a CTO recommendation feed entry decides on, or
 * `null` when the entry is not a resolvable CTO recommendation (a plain
 * mention, or a marker comment whose verb/issue we can't recover).
 */
export function ctoFeedKey(
  entry: InboxFeedEntry,
): { taskNumber: number; action: string } | null {
  if (!entry.ctoAction) return null;
  const taskNumber = issueNumberFromUrl(entry.url);
  if (taskNumber === null) return null;
  return { taskNumber, action: entry.ctoAction };
}

/**
 * True when this feed entry is a CTO recommendation that has not been
 * decided *for this rec*. A ledger verdict only counts if it was recorded
 * AFTER the rec landed — an older verdict referred to a previous rec for
 * the same (task, action) pair, not this fresh one. Treating those as
 * decided would silently drain the pending slot the moment a re-post
 * arrives (and is the same bug as the inbox showing pre-stamped
 * "Dismissed" badges on every periodic re-post).
 */
function isPending(
  entry: InboxFeedEntry,
  decided: Record<string, CtoLatestDecision>,
): boolean {
  const key = ctoFeedKey(entry);
  if (!key) return false;
  const v = decided[ctoDecisionKey(key.taskNumber, key.action)];
  if (!v) return true;
  const sent = Date.parse(entry.sentAt);
  const at = Date.parse(v.at);
  // Malformed timestamp on either side: fail closed (treat as decided) —
  // same shape as the old behaviour, no surprise drift.
  if (Number.isNaN(sent) || Number.isNaN(at)) return false;
  return at < sent;
}

/**
 * How many CTO recommendations already sit in the feed undecided. `decided`
 * is `latestCtoDecisions(ledger)` — the latest verdict per task+action,
 * with the timestamp it was recorded so we can scope to the *current* rec.
 */
export function countPendingCtoRecs(
  entries: InboxFeedEntry[],
  decided: Record<string, CtoLatestDecision>,
): number {
  return entries.reduce((n, e) => (isPending(e, decided) ? n + 1 : n), 0);
}

/**
 * Split `incoming` into the entries that may be appended now and the CTO
 * recommendations withheld because the operator's queue is already full.
 * Non-CTO entries always pass. CTO recommendations are admitted oldest-first
 * only up to the remaining headroom (`MAX_PENDING_CTO_RECS - current`).
 *
 * Pure — never mutates its inputs (immutability rule).
 */
export function applyCtoBackpressure(
  current: InboxFeedEntry[],
  incoming: InboxFeedEntry[],
  decided: Record<string, CtoLatestDecision>,
): { admitted: InboxFeedEntry[]; withheld: InboxFeedEntry[] } {
  let headroom = MAX_PENDING_CTO_RECS - countPendingCtoRecs(current, decided);
  const admitted: InboxFeedEntry[] = [];
  const withheld: InboxFeedEntry[] = [];

  for (const entry of incoming) {
    if (!ctoFeedKey(entry)) {
      admitted.push(entry); // not a CTO rec — never gated
      continue;
    }
    if (headroom > 0) {
      admitted.push(entry);
      headroom -= 1;
    } else {
      withheld.push(entry);
    }
  }

  return { admitted, withheld };
}
