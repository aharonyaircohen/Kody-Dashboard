/**
 * @fileType module
 * @domain chat-plugin-goals
 * @pattern plugin-manifest
 * @ai-summary Goals chat plugin (Step 5d). The manifest contributes the
 *   goal-mention send middleware (order 50 — BEFORE terminal intent at 100
 *   and slash expansion at 200, matching the pre-move check order in
 *   sendMessage). A resolvable mention of a known goal (`#<n>` /
 *   `goal:<n>` / legacy `goal:<slug>`) CONSUMES the message and dispatches
 *   the `goals:direct` host effect; the host (KodyChat's host-effect
 *   switch → sendMessage's consumed branch) calls `onDirectToGoal` to
 *   re-scope chat to that goal's planner and leaves the rest of the
 *   message in the composer.
 *
 *   Registration is HOST-owned (Step 6) and only hosts that route goals
 *   pass this plugin: ChatRailShell's desktop rail + mobile sheet do (they
 *   always supply `onDirectToGoal`); ClientChatSurface and GoalControl's
 *   planner dialog don't — pre-move the whole goal block was gated on
 *   `onDirectToGoal && knownGoals`, so surfaces without the props never
 *   routed goals and must not now. The goals list itself
 *   loads asynchronously (useGoals in ChatRailShell), so it travels via
 *   host context (`knownGoals` key), not the static manifest.
 *
 *   HOST/CORE by decision (do NOT move here): the goal-planner scope UI
 *   (`ChatContext kind: "goal-planner"`, planner session/exit wiring) —
 *   that's part of the frozen ChatRailApi/ChatContext host contract (plan
 *   H4) and is also mounted by GoalControl without any mention routing.
 */
import type { ChatPlugin } from "../../platform";
import { goalMentionMiddleware } from "./mention-middleware";

export const GOALS_PLUGIN_ID = "goals";

export const goalsChatPlugin: ChatPlugin = {
  id: GOALS_PLUGIN_ID,
  capabilities: ["middleware", "host-effects"],
  middleware: [goalMentionMiddleware],
};

export {
  GOALS_DIRECT_EFFECT,
  GOAL_MENTION_MIDDLEWARE_ID,
  GOAL_MENTION_MIDDLEWARE_ORDER,
  KNOWN_GOALS_HOST_KEY,
  goalMentionMiddleware,
  readGoalDirectEffect,
  readHostKnownGoals,
  type GoalDirectEffectPayload,
} from "./mention-middleware";
export {
  parseGoalMention,
  type GoalMention,
  type GoalRef,
} from "./goal-mention";
