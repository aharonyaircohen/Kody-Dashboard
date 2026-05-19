/**
 * @fileType util
 * @domain goals
 * @pattern goal-mention-parser
 * @ai-summary Pure parser that lets a user "direct chat to a goal by id"
 *   simply by mentioning it. Recognises a `goal:<id>` token (the same
 *   `goal:<id>` convention used for the GitHub label that attaches a task
 *   to a goal, and shown verbatim on each goal card), validates the id
 *   against the known goal ids, and returns the matched id plus the rest
 *   of the message with the token stripped. No React / no I/O — trivially
 *   unit-testable and reused by KodyChat's send path.
 */

/** Result of a successful goal-mention parse. */
export interface GoalMention {
  /** The matched goal id (exactly as it appears in the known-id list). */
  goalId: string;
  /** The message with the `goal:<id>` token removed and trimmed. */
  rest: string;
}

// A goal id is a slug: lowercase alphanumerics + dashes (see
// `uniqueGoalId()` in goals.ts). The token may be optionally prefixed
// with `#` or `@` (e.g. a user typing `#goal:q4-roadmap`) and must sit
// on a word boundary so it doesn't match inside a URL or label text.
// Group 1 = the full strippable token (`#goal:foo`), group 2 = the id.
const GOAL_TOKEN = /(?:^|[\s([])([#@]?goal:([a-z0-9][a-z0-9-]*))\b/i;

/**
 * Detect a `goal:<id>` mention in `text`.
 *
 * Returns `null` when there is no token, or when the token's id is not in
 * `knownIds` (so a stray "goal:something" in prose doesn't hijack the
 * chat). Matching is case-insensitive but the returned `goalId` is the
 * canonical value from `knownIds`.
 */
export function parseGoalMention(
  text: string,
  knownIds: readonly string[],
): GoalMention | null {
  if (!text || knownIds.length === 0) return null;

  const match = GOAL_TOKEN.exec(text);
  if (!match) return null;

  const token = match[1];
  const typed = match[2].toLowerCase();
  const goalId = knownIds.find((id) => id.toLowerCase() === typed);
  if (!goalId) return null;

  // Strip just the `[#@]?goal:<id>` token (the regex also consumed one
  // boundary char before it — keep that) and tidy up doubled spaces.
  const tokenStart = match.index + match[0].length - token.length;
  const rest = (
    text.slice(0, tokenStart) + text.slice(tokenStart + token.length)
  )
    .replace(/\s{2,}/g, " ")
    .trim();

  return { goalId, rest };
}
