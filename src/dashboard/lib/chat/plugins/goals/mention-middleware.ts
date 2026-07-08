/**
 * @fileType module
 * @domain chat-plugin-goals
 * @pattern send-middleware
 * @ai-summary Goal-mention send middleware (order 50 — pinned to run BEFORE
 *   terminal intent at 100 and slash expansion at 200; Step 5d). Pre-move,
 *   the goal check was the FIRST thing `sendMessage` did with the typed
 *   text — ahead of the whole middleware chain — so "/terminal ls #5"
 *   re-scoped to goal 5 rather than opening a terminal. Order 50 preserves
 *   that precedence inside the chain. On a resolvable mention the message
 *   is CONSUMED (never reaches any backend): the middleware dispatches the
 *   `goals:direct` host effect carrying the parsed goal id plus the rest
 *   of the message, and the host re-scopes chat to that goal's planner and
 *   puts the rest back in the composer for the user to send into the
 *   now-goal-scoped thread. Consuming the mention on its own Enter keeps
 *   it race-free (the scope swap drives a re-render before anything is
 *   sent). The goals list loads asynchronously per route, so it travels
 *   via the host-context snapshot (`knownGoals` key), same pattern as the
 *   commands plugin's `slashCommands`.
 */
import type { ChatHostEffect, ChatSendMiddleware } from "../../platform";
import { parseGoalMention, type GoalRef } from "./goal-mention";

export const GOAL_MENTION_MIDDLEWARE_ID = "goal-mention";
export const GOAL_MENTION_MIDDLEWARE_ORDER = 50;
export const GOALS_DIRECT_EFFECT = "goals:direct";
/** Host-context key the host fills with the fetched `GoalRef[]`. */
export const KNOWN_GOALS_HOST_KEY = "knownGoals";

export interface GoalDirectEffectPayload {
  /** The raw text the user typed (the mention token still in it). */
  rawText: string;
  /** The matched goal's canonical slug id (what `onDirectToGoal` takes). */
  goalId: string;
  /** The message with the mention token stripped — goes back to the composer. */
  rest: string;
}

export function readGoalDirectEffect(
  effect: ChatHostEffect,
): GoalDirectEffectPayload | null {
  if (effect.kind !== GOALS_DIRECT_EFFECT) return null;
  const payload = effect.payload as Partial<GoalDirectEffectPayload>;
  if (
    typeof payload?.rawText !== "string" ||
    typeof payload?.goalId !== "string" ||
    typeof payload?.rest !== "string"
  ) {
    return null;
  }
  return {
    rawText: payload.rawText,
    goalId: payload.goalId,
    rest: payload.rest,
  };
}

/**
 * Validate a host-context goals entry. The parser only reads `id` and
 * `discussionNumber`; malformed entries are dropped rather than crashing
 * the send.
 */
function isGoalRef(value: unknown): value is GoalRef {
  if (typeof value !== "object" || value === null) return false;
  const goal = value as Partial<GoalRef>;
  if (typeof goal.id !== "string") return false;
  return (
    goal.discussionNumber === undefined ||
    typeof goal.discussionNumber === "number"
  );
}

export function readHostKnownGoals(
  host: Readonly<Record<string, unknown>>,
): GoalRef[] {
  const value = host[KNOWN_GOALS_HOST_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter(isGoalRef);
}

export const goalMentionMiddleware: ChatSendMiddleware = {
  id: GOAL_MENTION_MIDDLEWARE_ID,
  order: GOAL_MENTION_MIDDLEWARE_ORDER,
  onSend(text, ctx) {
    const goals = readHostKnownGoals(ctx.host);
    if (goals.length === 0) return null;
    // Unresolvable tokens (a stray `#5` that's really a PR ref, or
    // "goal:something" in prose) pass through unchanged — exact pre-move
    // semantics; `parseGoalMention` only matches KNOWN goals.
    const mention = parseGoalMention(text, goals);
    if (!mention) return null;
    ctx.dispatchHostEffect({
      kind: GOALS_DIRECT_EFFECT,
      payload: {
        rawText: text,
        goalId: mention.goalId,
        rest: mention.rest,
      } satisfies GoalDirectEffectPayload,
    });
    return { consumed: true };
  },
};
