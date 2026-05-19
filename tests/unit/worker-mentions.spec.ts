import { describe, it, expect } from "vitest";
import {
  extractWorkerMentions,
  hasWorkerMention,
} from "@dashboard/lib/mentions/worker-mentions";

describe("extractWorkerMentions", () => {
  const known = ["cto", "qa-bot", "release-captain"];

  it("returns only @tokens that match a known worker slug", () => {
    expect(
      extractWorkerMentions("hey @cto and @octocat, see @qa-bot", known),
    ).toEqual(["cto", "qa-bot"]);
  });

  it("ignores unknown @logins (left to the GitHub-mention path)", () => {
    expect(extractWorkerMentions("@octocat @some-human", known)).toEqual([]);
  });

  it("dedupes and preserves first-appearance order", () => {
    expect(
      extractWorkerMentions("@qa-bot first then @cto then @qa-bot again", known),
    ).toEqual(["qa-bot", "cto"]);
  });

  it("is case-insensitive on the slug", () => {
    expect(extractWorkerMentions("ping @CTO please", known)).toEqual(["cto"]);
  });

  it("does not match emails or path-like text", () => {
    expect(
      extractWorkerMentions("mail user@cto.com or path/@cto", known),
    ).toEqual([]);
  });

  it("returns nothing when there are no known workers", () => {
    expect(extractWorkerMentions("@cto @qa-bot", [])).toEqual([]);
  });

  it("hasWorkerMention reflects extraction", () => {
    expect(hasWorkerMention("@cto", known)).toBe(true);
    expect(hasWorkerMention("@nobody", known)).toBe(false);
  });
});
