/**
 * @fileType utility
 * @domain kody
 * @pattern autonomous-feed-builder
 * @ai-summary Pure builder for the Activity → Auto feed. Turns recent PRs and
 *   commits into a single, time-ordered list of ACTIONS Kody took — "opened
 *   PR #12", "merged PR #9", "pushed <commit>" — rather than a static list of
 *   PRs. One PR can yield two events (opened + merged/closed) at different
 *   times. No I/O; the route feeds it cached GitHub data.
 */
import type { RecentPR, RecentCommit } from "../github-client";

export type AutonomousVerb = "opened" | "merged" | "closed" | "pushed";

export interface AutonomousEvent {
  id: string;
  verb: AutonomousVerb;
  kind: "pr" | "commit";
  /** Headline — PR title or commit message first line. */
  text: string;
  /** Short reference: `#12` for PRs, short SHA for commits. */
  ref: string;
  actor: string | null;
  /** When the action happened (ISO) — opened/merged/closed/commit time. */
  at: string;
  url: string;
}

function byNewest(a: AutonomousEvent, b: AutonomousEvent): number {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
}

/**
 * Merge PRs + commits into a newest-first action feed. A PR contributes an
 * "opened" event plus a "merged"/"closed" event when it has left the open
 * state, each stamped at the time that action actually occurred.
 */
export function buildAutonomousFeed(
  prs: RecentPR[],
  commits: RecentCommit[],
  limit = 60,
): AutonomousEvent[] {
  const events: AutonomousEvent[] = [];

  for (const pr of prs) {
    const ref = `#${pr.number}`;
    events.push({
      id: `pr-${pr.number}-opened`,
      verb: "opened",
      kind: "pr",
      text: pr.title,
      ref,
      actor: pr.author,
      at: pr.createdAt,
      url: pr.url,
    });
    if (pr.state === "merged" && pr.mergedAt) {
      events.push({
        id: `pr-${pr.number}-merged`,
        verb: "merged",
        kind: "pr",
        text: pr.title,
        ref,
        actor: pr.author,
        at: pr.mergedAt,
        url: pr.url,
      });
    } else if (pr.state === "closed" && pr.closedAt) {
      events.push({
        id: `pr-${pr.number}-closed`,
        verb: "closed",
        kind: "pr",
        text: pr.title,
        ref,
        actor: pr.author,
        at: pr.closedAt,
        url: pr.url,
      });
    }
  }

  for (const c of commits) {
    events.push({
      id: `commit-${c.sha}`,
      verb: "pushed",
      kind: "commit",
      text: c.message,
      ref: c.sha.slice(0, 7),
      actor: c.author,
      at: c.date,
      url: c.url,
    });
  }

  return events.sort(byNewest).slice(0, limit);
}
