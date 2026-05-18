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
 * Legacy fallback only. The command to run now comes from the CTO's own
 * `<!-- kody-cmd: @kody … -->` line (see cto.md); this map is used only for
 * older recs written before that line existed, so they stay actionable.
 */
const FALLBACK_COMMAND: Partial<Record<CtoAction, string>> = {
  execute: "@kody",
  fix: "@kody",
  "qa-review": "@kody ui-review",
};

/** Max length of a CTO-emitted command we'll post verbatim. */
const MAX_COMMAND_LEN = 300;

/**
 * Extract the literal command the CTO wants Approve to post, from the raw
 * comment body. Guarded: must be a single `@kody …` line, length-capped.
 * Returns null when absent/invalid (rec then surfaces read-only).
 */
export function parseCtoCommand(rawBody: string): string | null {
  const m = rawBody.match(/<!--\s*kody-cmd:\s*(@kody[^\n]*?)\s*-->/i);
  if (!m) return null;
  const cmd = m[1].trim();
  if (!cmd.startsWith("@kody") || cmd.length > MAX_COMMAND_LEN) return null;
  return cmd;
}

export function isDispatchable(action: CtoAction): boolean {
  return action in FALLBACK_COMMAND;
}

/** Legacy verb→command fallback for recs with no explicit `kody-cmd`. */
export function dispatchCommand(action: CtoAction): string | null {
  return FALLBACK_COMMAND[action] ?? null;
}

export interface CtoRecommendation {
  taskNumber: number;
  action: CtoAction;
  /** The exact `@kody …` command Approve will post, or null if none. */
  command: string | null;
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
  // Marker present ⇒ it IS a recommendation. Mirror detectCtoRecommendation:
  // an unrecoverable verb is `other` (non-dispatchable), never null. If this
  // returned null the entry would carry no `ctoAction`, and BOTH the pending
  // cap (applyCtoBackpressure) and the duplicate-collapse (ctoFeedKey) skip
  // anything without `ctoAction` — that silent bypass is exactly the flood.
  return parseAction(rawBody) ?? "other";
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

  // The command the CTO explicitly asked Approve to post (parsed from the
  // raw body at write time) wins. Legacy recs with no `kody-cmd` line fall
  // back to the verb→command map. No command → read-only (never misroute).
  const stored = entry.ctoCommand?.trim();
  const command =
    stored && stored.startsWith("@kody")
      ? stored
      : (dispatchCommand(action) ?? null);

  return { taskNumber, action, command, dispatchable: command !== null };
}
