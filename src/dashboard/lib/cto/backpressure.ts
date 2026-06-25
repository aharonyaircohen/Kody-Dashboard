/**
 * @fileType utility
 * @domain kody
 * @pattern cto-backpressure-gate
 * @ai-summary Code-enforced cap on **pending** CTO recommendations in the
 *   inbox. The `cto.md` agent is told to stop at 10, but that is prose an
 *   LLM re-counts every tick from a ledger — it drifts and over-posts. This
 *   module makes the cap deterministic at the one server-side write point
 *   (the webhook → inbox-feed append): a CTO recommendation entry is only
 *   admitted while fewer than `MAX_PENDING_CTO_RECS` are still undecided.
 *
 *   "Pending" = a feed entry that is a CTO recommendation (`ctoAction` set,
 *   resolvable to an issue number) whose `(agentResponsibility, taskNumber, action)` has no
 *   verdict in the trust ledger. Once the operator
 *   approves/rejects, that slot frees and later recommendations flow again.
 *
 *   Non-CTO mentions are never gated — only CTO recommendation entries count
 *   against, and are limited by, the cap.
 */
import type { InboxFeedEntry } from "../inbox/feed";
import { trustDecisionKey, type TrustLatestDecision } from "./trust-state";
import { DEFAULT_AGENT_SLUG } from "./recommendation";

/**
 * Hard ceiling on undecided recommendations visible in the inbox at once,
 * applied **per agentResponsibility** — a chatty agentResponsibility can't crowd other agentResponsibilities out of
 * the operator's queue. Mirrors the "at most 10 pending" rule in
 * state-repo `agents/*.md`, but enforced here so it actually holds.
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
 * The `(agentResponsibility, taskNumber, action)` a recommendation feed entry decides on,
 * or `null` when the entry is not a resolvable recommendation (a plain
 * mention, or a marker comment whose verb/issue we can't recover). Legacy
 * entries with no `ctoAgentResponsibility` default to `ctoAgent`, then the CTO slug.
 */
export function ctoFeedKey(
  entry: InboxFeedEntry,
): { agentResponsibility: string; taskNumber: number; action: string } | null {
  if (!entry.ctoAction) return null;
  const taskNumber = issueNumberFromUrl(entry.url);
  if (taskNumber === null) return null;
  return {
    agentResponsibility: entry.ctoAgentResponsibility ?? entry.ctoAgent ?? DEFAULT_AGENT_SLUG,
    taskNumber,
    action: entry.ctoAction,
  };
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
  decided: Record<string, TrustLatestDecision>,
): boolean {
  const key = ctoFeedKey(entry);
  if (!key) return false;
  const v = decided[trustDecisionKey(key.agentResponsibility, key.taskNumber, key.action)];
  if (!v) return true;
  const sent = Date.parse(entry.sentAt);
  const at = Date.parse(v.at);
  // Malformed timestamp on either side: fail closed (treat as decided) —
  // same shape as the old behaviour, no surprise drift.
  if (Number.isNaN(sent) || Number.isNaN(at)) return false;
  return at < sent;
}

/**
 * Undecided recommendations already in the feed, counted **per agentResponsibility slug**.
 * `decided` is `latestTrustDecisions(ledger)` — the latest verdict per
 * agentResponsibility+task+action, with the timestamp it was recorded so we can scope to
 * the *current* rec.
 */
export function countPendingByAgentResponsibility(
  entries: InboxFeedEntry[],
  decided: Record<string, TrustLatestDecision>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!isPending(e, decided)) continue;
    const key = ctoFeedKey(e);
    if (!key) continue;
    counts.set(key.agentResponsibility, (counts.get(key.agentResponsibility) ?? 0) + 1);
  }
  return counts;
}

/**
 * Total undecided recommendations across all agentResponsibilities. Retained for logging.
 */
export function countPendingCtoRecs(
  entries: InboxFeedEntry[],
  decided: Record<string, TrustLatestDecision>,
): number {
  return entries.reduce((n, e) => (isPending(e, decided) ? n + 1 : n), 0);
}

/**
 * Split `incoming` into the entries that may be appended now and the
 * recommendations withheld because that agentResponsibility's queue is already full.
 * Non-recommendation entries always pass. Recommendations are admitted
 * oldest-first up to each agentResponsibility's own remaining headroom
 * (`MAX_PENDING_CTO_RECS - that agentResponsibility's pending count`), so one noisy agentResponsibility
 * can't starve another's queue.
 *
 * Pure — never mutates its inputs (immutability rule).
 */
export function applyCtoBackpressure(
  current: InboxFeedEntry[],
  incoming: InboxFeedEntry[],
  decided: Record<string, TrustLatestDecision>,
): { admitted: InboxFeedEntry[]; withheld: InboxFeedEntry[] } {
  const pending = countPendingByAgentResponsibility(current, decided);
  const admitted: InboxFeedEntry[] = [];
  const withheld: InboxFeedEntry[] = [];

  for (const entry of incoming) {
    const key = ctoFeedKey(entry);
    if (!key) {
      admitted.push(entry); // not a recommendation — never gated
      continue;
    }
    const used = pending.get(key.agentResponsibility) ?? 0;
    if (used < MAX_PENDING_CTO_RECS) {
      admitted.push(entry);
      pending.set(key.agentResponsibility, used + 1);
    } else {
      withheld.push(entry);
    }
  }

  return { admitted, withheld };
}
