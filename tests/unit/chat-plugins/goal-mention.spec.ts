import { describe, it, expect } from "vitest";
import {
  parseGoalMention,
  type GoalRef,
} from "@dashboard/lib/chat/plugins/goals";

const GOALS: GoalRef[] = [
  { id: "q4-roadmap", discussionNumber: 12 },
  { id: "mobile-app", discussionNumber: 7 },
  { id: "ga" }, // no backing discussion
];

describe("parseGoalMention", () => {
  it("returns null when there is no token", () => {
    expect(parseGoalMention("hello there", GOALS)).toBeNull();
  });

  it("returns null when the number is not a known goal discussion", () => {
    expect(parseGoalMention("goal:999 what's left", GOALS)).toBeNull();
    expect(parseGoalMention("#999 what's left", GOALS)).toBeNull();
  });

  it("returns null for empty text or no goals", () => {
    expect(parseGoalMention("", GOALS)).toBeNull();
    expect(parseGoalMention("goal:12", [])).toBeNull();
  });

  it("resolves goal:<number> to the canonical slug id", () => {
    expect(parseGoalMention("goal:12 what is left?", GOALS)).toEqual({
      goalId: "q4-roadmap",
      rest: "what is left?",
    });
  });

  it("resolves a bare #<number> mid-sentence", () => {
    expect(parseGoalMention("can you check #7 for me", GOALS)).toEqual({
      goalId: "mobile-app",
      rest: "can you check for me",
    });
  });

  it("accepts #goal:<number> / @goal:<number> and strips the token", () => {
    expect(parseGoalMention("#goal:12 ship it", GOALS)).toEqual({
      goalId: "q4-roadmap",
      rest: "ship it",
    });
    expect(parseGoalMention("(@goal:7)", GOALS)).toEqual({
      goalId: "mobile-app",
      rest: "()",
    });
  });

  it("still resolves the legacy goal:<slug> form", () => {
    expect(parseGoalMention("GOAL:Q4-Roadmap status", GOALS)).toEqual({
      goalId: "q4-roadmap",
      rest: "status",
    });
    expect(parseGoalMention("goal:ga go", GOALS)).toEqual({
      goalId: "ga",
      rest: "go",
    });
  });

  it("does not match inside a larger word/url", () => {
    expect(parseGoalMention("see https://x/goal:12-extra", GOALS)).toBeNull();
  });

  it("returns an empty rest when only the token was typed", () => {
    expect(parseGoalMention("  #12  ", GOALS)).toEqual({
      goalId: "q4-roadmap",
      rest: "",
    });
  });
});
