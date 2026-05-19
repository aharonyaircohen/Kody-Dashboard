import { describe, it, expect } from "vitest";
import { parseGoalMention } from "../../src/dashboard/lib/goal-mention";

const KNOWN = ["q4-roadmap", "mobile-app", "ga"];

describe("parseGoalMention", () => {
  it("returns null when there is no token", () => {
    expect(parseGoalMention("hello there", KNOWN)).toBeNull();
  });

  it("returns null when the id is not a known goal", () => {
    expect(parseGoalMention("goal:nope what's left", KNOWN)).toBeNull();
  });

  it("returns null for empty text or no known goals", () => {
    expect(parseGoalMention("", KNOWN)).toBeNull();
    expect(parseGoalMention("goal:q4-roadmap", [])).toBeNull();
  });

  it("matches a bare token at the start and strips it", () => {
    expect(parseGoalMention("goal:q4-roadmap what is left?", KNOWN)).toEqual({
      goalId: "q4-roadmap",
      rest: "what is left?",
    });
  });

  it("matches a token mid-sentence", () => {
    expect(
      parseGoalMention("can you check goal:mobile-app for me", KNOWN),
    ).toEqual({ goalId: "mobile-app", rest: "can you check for me" });
  });

  it("accepts an optional # or @ prefix and strips the whole token", () => {
    expect(parseGoalMention("#goal:ga ship it", KNOWN)).toEqual({
      goalId: "ga",
      rest: "ship it",
    });
    expect(parseGoalMention("(@goal:ga)", KNOWN)).toEqual({
      goalId: "ga",
      rest: "()",
    });
  });

  it("is case-insensitive but returns the canonical id", () => {
    expect(parseGoalMention("GOAL:Q4-Roadmap status", KNOWN)).toEqual({
      goalId: "q4-roadmap",
      rest: "status",
    });
  });

  it("does not match inside a larger word/url", () => {
    expect(
      parseGoalMention("see https://x/goal:q4-roadmap-extra", KNOWN),
    ).toBeNull();
  });

  it("returns an empty rest when only the token was typed", () => {
    expect(parseGoalMention("  goal:ga  ", KNOWN)).toEqual({
      goalId: "ga",
      rest: "",
    });
  });
});
