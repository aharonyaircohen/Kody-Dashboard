/**
 * @fileType util
 * @domain goals
 * @pattern goal-mention-parser
 * @ai-summary Pure parser that lets a user "direct chat to a goal by id"
 *   simply by mentioning it. A goal's user-facing id is its backing
 *   GitHub Discussion number (shown as `#<n>` next to the title, like a
 *   task's issue number). Recognises `goal:<n>`, `#goal:<n>`, a bare
 *   `#<n>`, or the legacy `goal:<slug>` form, resolves it against the
 *   known goals, and returns the canonical goal slug id plus the rest of
 *   the message with the token stripped. No React / no I/O — trivially
 *   unit-testable and reused by KodyChat's send path.
 */

/** Minimal goal shape the parser needs to resolve a mention. */
export interface GoalRef {
  /** Canonical slug id (the value `directToGoal` looks up). */
  id: string;
  /** Backing GitHub Discussion number — the user-facing "#" id. */
  discussionNumber?: number;
}

/** Result of a successful goal-mention parse. */
export interface GoalMention {
  /** The matched goal's canonical slug id. */
  goalId: string;
  /** The message with the matched token removed and trimmed. */
  rest: string;
}

// Group 1 = the full strippable token. Either a `[#@]?goal:<key>` token
// (key = discussion number or legacy slug) or a bare `#<number>`. A
// leading boundary keeps it from matching inside a URL/word.
const GOAL_TOKEN =
  /(?:^|[\s([])([#@]?goal:([a-z0-9][a-z0-9-]*)|#(\d+))\b/i;

/**
 * Detect a goal mention in `text`.
 *
 * Resolves the token against `goals` by Discussion number first, then by
 * legacy slug id (case-insensitive). Returns `null` when there is no
 * token or it doesn't resolve to a known goal (so a stray `#5` that's
 * really a PR ref, or "goal:something" in prose, doesn't hijack chat).
 */
export function parseGoalMention(
  text: string,
  goals: ReadonlyArray<GoalRef>,
): GoalMention | null {
  if (!text || goals.length === 0) return null;

  const match = GOAL_TOKEN.exec(text);
  if (!match) return null;

  const token = match[1];
  // match[2] = the `goal:<key>` key; match[3] = the bare `#<number>`.
  const key = (match[2] ?? match[3] ?? "").toLowerCase();
  if (!key) return null;

  // Discussion number wins (it's the user-facing id). Fall back to the
  // legacy slug so existing `goal:<slug>` mentions keep working.
  const byNumber = /^\d+$/.test(key)
    ? goals.find((g) => g.discussionNumber === Number(key))
    : undefined;
  const goal =
    byNumber ?? goals.find((g) => g.id.toLowerCase() === key);
  if (!goal) return null;

  // Strip just the token (the regex also consumed one boundary char
  // before it — keep that) and tidy up doubled spaces.
  const tokenStart = match.index + match[0].length - token.length;
  const rest = (
    text.slice(0, tokenStart) + text.slice(tokenStart + token.length)
  )
    .replace(/\s{2,}/g, " ")
    .trim();

  return { goalId: goal.id, rest };
}
