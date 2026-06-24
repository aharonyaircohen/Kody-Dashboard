import { describe, it, expect } from "vitest";
import {
  extractFirstStaffMentionCandidate,
  extractStaffMentions,
  hasStaffMention,
  parseStaffMentionTrigger,
  replaceStaffMentionTrigger,
} from "@dashboard/lib/mentions/agent-mentions";

describe("extractStaffMentions", () => {
  const known = ["cto", "qa-bot", "release-captain"];

  it("returns only @tokens that match a known agent slug", () => {
    expect(
      extractStaffMentions("hey @cto and @octocat, see @qa-bot", known),
    ).toEqual(["cto", "qa-bot"]);
  });

  it("ignores unknown @logins (left to the GitHub-mention path)", () => {
    expect(extractStaffMentions("@octocat @some-human", known)).toEqual([]);
  });

  it("dedupes and preserves first-appearance order", () => {
    expect(
      extractStaffMentions("@qa-bot first then @cto then @qa-bot again", known),
    ).toEqual(["qa-bot", "cto"]);
  });

  it("is case-insensitive on the slug", () => {
    expect(extractStaffMentions("ping @CTO please", known)).toEqual(["cto"]);
  });

  it("does not match emails or path-like text", () => {
    expect(
      extractStaffMentions("mail user@cto.com or path/@cto", known),
    ).toEqual([]);
  });

  it("returns nothing when there are no known agent", () => {
    expect(extractStaffMentions("@cto @qa-bot", [])).toEqual([]);
  });

  it("can still route a direct @agent turn before the roster loads", () => {
    expect(
      extractFirstStaffMentionCandidate(
        "@pedagogical-math-manager who r u",
        [],
      ),
    ).toBe("pedagogical-math-manager");
    expect(
      extractFirstStaffMentionCandidate("mail user@cto.com", []),
    ).toBeNull();
    expect(extractFirstStaffMentionCandidate("path/@cto", [])).toBeNull();
  });

  it("hasStaffMention reflects extraction", () => {
    expect(hasStaffMention("@cto", known)).toBe(true);
    expect(hasStaffMention("@nobody", known)).toBe(false);
  });

  it("detects an active @agent trigger at the caret", () => {
    expect(parseStaffMentionTrigger("ask @", "ask @".length)).toEqual({
      start: 4,
      end: 5,
      query: "",
    });
    expect(parseStaffMentionTrigger("ask @ct", "ask @ct".length)).toEqual({
      start: 4,
      end: 7,
      query: "ct",
    });
    expect(parseStaffMentionTrigger("email user@cto.com", 10)).toBeNull();
    expect(
      parseStaffMentionTrigger("path/@cto", "path/@cto".length),
    ).toBeNull();
  });

  it("replaces the active trigger with the selected agent mention", () => {
    const body = "ask @ct to review";
    const trigger = parseStaffMentionTrigger(body, 7);

    expect(trigger).not.toBeNull();
    expect(replaceStaffMentionTrigger(body, trigger!, "cto")).toBe(
      "ask @cto to review",
    );

    const trailingTrigger = parseStaffMentionTrigger("ask @ct", 7);
    expect(replaceStaffMentionTrigger("ask @ct", trailingTrigger!, "cto")).toBe(
      "ask @cto ",
    );
  });
});
