import { describe, it, expect } from "vitest";
import {
  extractStaffMentions,
  hasStaffMention,
} from "@dashboard/lib/mentions/staff-mentions";

describe("extractStaffMentions", () => {
  const known = ["cto", "qa-bot", "release-captain"];

  it("returns only @tokens that match a known staff slug", () => {
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

  it("returns nothing when there are no known staff", () => {
    expect(extractStaffMentions("@cto @qa-bot", [])).toEqual([]);
  });

  it("hasStaffMention reflects extraction", () => {
    expect(hasStaffMention("@cto", known)).toBe(true);
    expect(hasStaffMention("@nobody", known)).toBe(false);
  });
});
