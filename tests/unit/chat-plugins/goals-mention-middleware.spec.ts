/**
 * @fileoverview Behavior contract for the goals plugin's goal-mention send
 *   middleware (Step 5d — the plan-required regression test that a goal
 *   mention CONSUMES the message: it never reaches any backend, and no
 *   later middleware sees it). Mention forms (`#<n>`, `goal:<n>`,
 *   `#goal:<n>`, legacy `goal:<slug>`) resolve against the host-context
 *   `knownGoals` list; a match dispatches the `goals:direct` host effect
 *   (goal id + the rest of the message for the composer) and stops the
 *   chain. Non-mentions and unresolvable tokens pass through untouched.
 *   Ordering is pinned at 50 — BEFORE terminal intent (100) and slash
 *   expansion (200) — matching the pre-move sendMessage check order
 *   (goal parsing ran before the whole middleware chain).
 * @testFramework vitest
 * @domain chat-plugins
 */
import { describe, expect, it } from "vitest";

import {
  FULL_GRANT,
  createChatPluginRegistry,
  type ChatHostEffect,
} from "@kody-ade/kody-chat/platform";
import {
  SLASH_COMMANDS_HOST_KEY,
  SLASH_EXPANSION_MIDDLEWARE_ID,
  commandsChatPlugin,
  type SlashCommand,
} from "@kody-ade/kody-chat/plugins/commands";
import {
  GOALS_DIRECT_EFFECT,
  GOAL_MENTION_MIDDLEWARE_ID,
  GOAL_MENTION_MIDDLEWARE_ORDER,
  KNOWN_GOALS_HOST_KEY,
  goalsChatPlugin,
  readGoalDirectEffect,
  readHostKnownGoals,
  type GoalRef,
} from "@kody-ade/kody-chat/plugins/goals";
import {
  TERMINAL_INTENT_MIDDLEWARE_ID,
  terminalChatPlugin,
} from "@kody-chat/chat/plugins/terminal";

const GOALS: GoalRef[] = [
  { id: "q4-roadmap", discussionNumber: 12 },
  { id: "mobile-app", discussionNumber: 7 },
  { id: "ga" }, // legacy: no backing discussion
];

const COMMANDS: SlashCommand[] = [
  {
    slug: "plan",
    description: "Plan work",
    argumentHint: "<feature>",
    body: "Research first, then plan: $ARGUMENTS",
    source: "builtin",
  },
];

function makeChain(goals: unknown = GOALS) {
  const registry = createChatPluginRegistry();
  // Register goals LAST — precedence must come from `order`, not
  // registration sequence.
  registry.register(terminalChatPlugin, FULL_GRANT);
  registry.register(commandsChatPlugin, FULL_GRANT);
  registry.register(goalsChatPlugin, FULL_GRANT);
  const effects: ChatHostEffect[] = [];
  const run = (text: string) =>
    registry.runSendMiddleware(text, {
      host: {
        [KNOWN_GOALS_HOST_KEY]: goals,
        [SLASH_COMMANDS_HOST_KEY]: COMMANDS,
      },
      dispatchHostEffect: (effect) => effects.push(effect),
    });
  return { registry, effects, run };
}

describe("goal-mention middleware (goals plugin, order 50)", () => {
  it("orders before the terminal-intent and slash-expansion middleware", () => {
    const { registry } = makeChain();
    expect(registry.middleware().map((m) => m.id)).toEqual([
      GOAL_MENTION_MIDDLEWARE_ID,
      TERMINAL_INTENT_MIDDLEWARE_ID,
      SLASH_EXPANSION_MIDDLEWARE_ID,
    ]);
    expect(GOAL_MENTION_MIDDLEWARE_ORDER).toBeLessThan(100);
  });

  it("consumes a bare #<n> mention — the message never leaves the chain", () => {
    const { run, effects } = makeChain();
    const outcome = run("can you check #7 for me");
    // consumedBy = the send stops here; sendMessage never reaches any
    // transport/backend for this message.
    expect(outcome.consumedBy).toBe(GOAL_MENTION_MIDDLEWARE_ID);
    expect(effects).toHaveLength(1);
    expect(readGoalDirectEffect(effects[0])).toEqual({
      rawText: "can you check #7 for me",
      goalId: "mobile-app",
      rest: "can you check for me",
    });
  });

  it("consumes goal:<n>, #goal:<n>, and legacy goal:<slug> forms", () => {
    const cases: Array<[string, string, string]> = [
      ["goal:12 what is left?", "q4-roadmap", "what is left?"],
      ["#goal:12 ship it", "q4-roadmap", "ship it"],
      ["goal:ga go", "ga", "go"],
    ];
    for (const [text, goalId, rest] of cases) {
      const { run, effects } = makeChain();
      const outcome = run(text);
      expect(outcome.consumedBy).toBe(GOAL_MENTION_MIDDLEWARE_ID);
      expect(readGoalDirectEffect(effects[0])).toEqual({
        rawText: text,
        goalId,
        rest,
      });
    }
  });

  it("wins over a terminal intent in the same message (pre-move precedence)", () => {
    // Pre-move, goal parsing was the FIRST check in sendMessage — before
    // the terminal-intent rewrite — so a goal mention inside a /terminal
    // line re-scoped to the goal instead of opening a terminal.
    const { run, effects } = makeChain();
    const outcome = run("/terminal ls #7");
    expect(outcome.consumedBy).toBe(GOAL_MENTION_MIDDLEWARE_ID);
    expect(effects).toHaveLength(1);
    expect(readGoalDirectEffect(effects[0])?.rest).toBe("/terminal ls");
  });

  it("wins over slash expansion in the same message", () => {
    const { run, effects } = makeChain();
    const outcome = run("/plan finish #12");
    expect(outcome.consumedBy).toBe(GOAL_MENTION_MIDDLEWARE_ID);
    expect(effects).toHaveLength(1);
    expect(readGoalDirectEffect(effects[0])).toEqual({
      rawText: "/plan finish #12",
      goalId: "q4-roadmap",
      rest: "/plan finish",
    });
  });

  it("passes non-mentions and unresolvable tokens through with no effect", () => {
    const { run, effects } = makeChain();
    // A stray #<n> that is NOT a known goal (e.g. a PR ref) must not
    // hijack chat — exact pre-move semantics.
    expect(run("look at #999 please").consumedBy).toBeUndefined();
    expect(run("look at #999 please").text).toBe("look at #999 please");
    expect(run("plain message").consumedBy).toBeUndefined();
    expect(run("goal:unknown-slug hi").consumedBy).toBeUndefined();
    expect(effects).toHaveLength(0);
  });

  it("passes everything through when the host supplies no goals", () => {
    // Absent host key entirely (e.g. a surface that never wires goals):
    expect(readHostKnownGoals({})).toEqual([]);
    // `null` (not `undefined` — that would trip the fixture's default arg)
    // stands in for a host key that is present but not a list.
    for (const goals of [[], null, "not-an-array"]) {
      const { run, effects } = makeChain(goals);
      const outcome = run("check #7");
      expect(outcome.consumedBy).toBeUndefined();
      expect(outcome.text).toBe("check #7");
      expect(effects).toHaveLength(0);
    }
  });

  it("still transforms terminal/slash input normally when no goal matches", () => {
    // The goals middleware must be a pure pass-through for non-mentions:
    // downstream middleware behavior is unchanged.
    const { run } = makeChain();
    expect(run("/plan dark mode").text).toBe(
      "Research first, then plan: dark mode",
    );
  });

  it("drops malformed host-context goal entries instead of crashing", () => {
    const goals = [
      null,
      42,
      { discussionNumber: 7 }, // missing id
      { id: "mobile-app", discussionNumber: 7 },
    ];
    expect(readHostKnownGoals({ [KNOWN_GOALS_HOST_KEY]: goals })).toEqual([
      { id: "mobile-app", discussionNumber: 7 },
    ]);
    const { run, effects } = makeChain(goals);
    expect(run("check #7").consumedBy).toBe(GOAL_MENTION_MIDDLEWARE_ID);
    expect(readGoalDirectEffect(effects[0])?.goalId).toBe("mobile-app");
  });

  it("ignores foreign or malformed effects when reading the goal-direct payload", () => {
    expect(readGoalDirectEffect({ kind: "other:effect" })).toBeNull();
    expect(
      readGoalDirectEffect({
        kind: GOALS_DIRECT_EFFECT,
        payload: { goalId: "q4-roadmap" },
      }),
    ).toBeNull();
  });
});
