/**
 * @fileType utility
 * @domain kody
 * @pattern cto-recommendation-detect
 * @ai-summary Pure detector: given an inbox entry, decide whether it is a
 *   CTO recommendation and, if so, extract the task number + action so the
 *   inbox can render one-tap Approve/Reject. The CTO worker leads every
 *   recommendation comment with `🧭 **CTO recommendation** — \`<action>\``
 *   (see .kody/workers/cto.md); the inbox snippet has code fences stripped,
 *   so we match on the prose marker, not the backticks.
 */
import type { InboxEntry } from "../inbox/types";

/** Actions the inbox can act on in Phase 1. */
const ACTIONABLE = ["execute"] as const;
export type CtoActionable = (typeof ACTIONABLE)[number];

export interface CtoRecommendation {
  taskNumber: number;
  action: CtoActionable;
}

const MARKER = /CTO recommendation/i;

/** Pull `123` out of a `.../issues/123` or `.../issues/123#...` URL. */
function issueNumberFromUrl(url: string): number | null {
  const m = url.match(/\/issues\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function detectCtoRecommendation(
  entry: InboxEntry,
): CtoRecommendation | null {
  const haystack = `${entry.title ?? ""} ${entry.snippet ?? ""}`;
  if (!MARKER.test(haystack)) return null;
  if (entry.threadType && !/issue/i.test(entry.threadType)) return null;

  const taskNumber = issueNumberFromUrl(entry.url);
  if (taskNumber === null) return null;

  // Phase 1 only acts on `execute`. If the snippet names another verb we
  // still recognise it as a CTO rec but expose only the supported action;
  // unknown/other actions fall back to `execute` (the default rec).
  const action: CtoActionable =
    ACTIONABLE.find((a) => new RegExp(`\\b${a}\\b`, "i").test(haystack)) ??
    "execute";

  return { taskNumber, action };
}
