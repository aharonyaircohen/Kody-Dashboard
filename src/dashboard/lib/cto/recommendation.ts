/**
 * @fileType utility
 * @domain kody
 * @pattern cto-recommendation-detect
 * @ai-summary Pure detector: given an inbox entry, decide whether it is a
 *   CTO recommendation and, if so, extract the task number + the *actual*
 *   action the CTO named. The CTO worker leads every recommendation comment
 *   with `🧭 **CTO recommendation** — \`<action>\`` (see .kody/workers/cto.md);
 *   the inbox snippet has code fences stripped, so we match the prose marker
 *   and read the verb that follows it — never defaulting to `execute`.
 *
 *   Only `execute`/`fix` are *dispatchable* from the dashboard: both resolve
 *   to the engine's single write path (an `@kody` comment on the task — for
 *   `fix` the QA-failure comment is already in-thread, so re-dispatching is
 *   the fix). `qa-review`/`approve`/`comment` have no dashboard executor
 *   (per cto.md, approve is a human merge gate) — they surface read-only so
 *   approving can never silently post the wrong command.
 */
import type { InboxEntry } from "../inbox/types";

/**
 * Every action the CTO worker may emit (see cto.md "Restrictions"), plus
 * `other` — a catch-all for marker-bearing comments whose verb we can't
 * parse (legacy / free-form recs). `other` is non-dispatchable and lives in
 * its own ledger bucket, so an unparsed rec stays visible (Reject + GitHub
 * link) without ever rerouting to `@kody` or polluting `execute` trust.
 */
export const CTO_ACTIONS = [
  "execute",
  "fix",
  "qa-review",
  "approve",
  "comment",
  "other",
] as const;
export type CtoAction = (typeof CTO_ACTIONS)[number];

/** Back-compat alias — callers that only cared about the type name. */
export type CtoActionable = CtoAction;

/**
 * Actions the dashboard can run on approve, mapped to the exact engine
 * command posted on the task. `execute`/`fix` re-dispatch the task (for
 * `fix` the QA-failure comment is already in-thread); `qa-review` posts
 * the UI/QA review command the engine already understands.
 */
const DISPATCH_COMMAND: Partial<Record<CtoAction, string>> = {
  execute: "@kody",
  fix: "@kody",
  "qa-review": "@kody ui-review",
};

export function isDispatchable(action: CtoAction): boolean {
  return action in DISPATCH_COMMAND;
}

/** The `@kody …` comment to post when this action is approved, or null. */
export function dispatchCommand(action: CtoAction): string | null {
  return DISPATCH_COMMAND[action] ?? null;
}

export interface CtoRecommendation {
  taskNumber: number;
  action: CtoAction;
  /** True when Approve can actually run the action from the dashboard. */
  dispatchable: boolean;
}

const MARKER = /CTO recommendation/i;

/** Pull `123` out of a `.../issues/123` or `.../issues/123#...` URL. */
function issueNumberFromUrl(url: string): number | null {
  const m = url.match(/\/issues\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Read the action the CTO named on the marker line. We scan for the longest
 * matching verb first (`qa-review` before `review`-free tokens) so a
 * substring never wins. Returns null when no known verb is present — we
 * fail closed rather than assume `execute` (the old bug).
 */
const PARSEABLE: CtoAction[] = [
  "qa-review",
  "execute",
  "fix",
  "approve",
  "comment",
];

function parseAction(haystack: string): CtoAction | null {
  for (const a of PARSEABLE) {
    if (new RegExp(`\\b${a.replace("-", "[- ]?")}\\b`, "i").test(haystack)) {
      return a;
    }
  }
  return null;
}

/**
 * Parse the CTO action from a *raw* comment body (backticks intact) at
 * inbox-write time. This is the reliable path: the 240-char plain-text
 * snippet collapses backtick spans to `[code]`, so the verb on the marker
 * line is often gone by the time the client sees it. Returns null when the
 * body isn't a CTO recommendation. Stored on the entry as `ctoAction`.
 */
export function parseCtoAction(rawBody: string): CtoAction | null {
  if (!MARKER.test(rawBody)) return null;
  return parseAction(rawBody);
}

/** Narrow an arbitrary string to a known CtoAction (for stored values). */
function asCtoAction(v: string | undefined): CtoAction | null {
  return v && (CTO_ACTIONS as readonly string[]).includes(v)
    ? (v as CtoAction)
    : null;
}

export function detectCtoRecommendation(
  entry: InboxEntry,
): CtoRecommendation | null {
  const haystack = `${entry.title ?? ""} ${entry.snippet ?? ""}`;
  if (!MARKER.test(haystack)) return null;
  if (entry.threadType && !/issue/i.test(entry.threadType)) return null;

  const taskNumber = issueNumberFromUrl(entry.url);
  if (taskNumber === null) return null;

  // Prefer the action parsed from the raw body at write time (`ctoAction`).
  // Fall back to the lossy snippet for legacy entries written before that
  // field existed. Marker present but verb unrecoverable → `other`
  // (non-dispatchable) so the rec stays visible without ever misrouting.
  const action: CtoAction =
    asCtoAction(entry.ctoAction) ?? parseAction(haystack) ?? "other";

  return { taskNumber, action, dispatchable: isDispatchable(action) };
}
