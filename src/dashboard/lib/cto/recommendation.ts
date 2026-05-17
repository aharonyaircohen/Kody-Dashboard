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

/** Every action the CTO worker may emit (see cto.md "Restrictions"). */
export const CTO_ACTIONS = [
  "execute",
  "fix",
  "qa-review",
  "approve",
  "comment",
] as const;
export type CtoAction = (typeof CTO_ACTIONS)[number];

/** Back-compat alias — callers that only cared about the type name. */
export type CtoActionable = CtoAction;

/** Actions the dashboard can run via the engine's `@kody` dispatch path. */
const DISPATCHABLE = new Set<CtoAction>(["execute", "fix"]);

export function isDispatchable(action: CtoAction): boolean {
  return DISPATCHABLE.has(action);
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
function parseAction(haystack: string): CtoAction | null {
  for (const a of CTO_ACTIONS) {
    if (new RegExp(`\\b${a.replace("-", "[- ]?")}\\b`, "i").test(haystack)) {
      return a;
    }
  }
  return null;
}

export function detectCtoRecommendation(
  entry: InboxEntry,
): CtoRecommendation | null {
  const haystack = `${entry.title ?? ""} ${entry.snippet ?? ""}`;
  if (!MARKER.test(haystack)) return null;
  if (entry.threadType && !/issue/i.test(entry.threadType)) return null;

  const taskNumber = issueNumberFromUrl(entry.url);
  if (taskNumber === null) return null;

  const action = parseAction(haystack);
  if (action === null) return null;

  return { taskNumber, action, dispatchable: isDispatchable(action) };
}
