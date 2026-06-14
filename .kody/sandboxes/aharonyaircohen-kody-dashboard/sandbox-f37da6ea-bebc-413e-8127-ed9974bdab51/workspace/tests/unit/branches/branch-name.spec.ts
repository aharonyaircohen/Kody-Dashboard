import { describe, expect, it } from "vitest";
import {
  buildBranchName,
  parseIssueFromBranch,
  slugifyTitle,
} from "@dashboard/lib/branches/domain/branch-name";

describe("slugifyTitle", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugifyTitle("Fix Login Button")).toBe("fix-login-button");
  });

  it("strips punctuation", () => {
    expect(slugifyTitle("Fix: login (button)!")).toBe("fix-login-button");
  });

  it("collapses runs of dashes and trims edges", () => {
    expect(slugifyTitle("--foo---bar--")).toBe("foo-bar");
  });

  it("caps length at 40 chars", () => {
    const longTitle = "a".repeat(80);
    expect(slugifyTitle(longTitle)).toHaveLength(40);
  });

  it('falls back to "untitled" when input is empty after cleaning', () => {
    expect(slugifyTitle("!!!")).toBe("untitled");
    expect(slugifyTitle("")).toBe("untitled");
  });

  it("strips emoji and unicode that is not a-z0-9", () => {
    expect(slugifyTitle("Fix 🐛 bug in component")).toBe(
      "fix-bug-in-component",
    );
  });

  it("preserves digits", () => {
    expect(slugifyTitle("Issue 42 follow-up")).toBe("issue-42-follow-up");
  });

  it("does not produce leading/trailing dashes when title starts with punctuation", () => {
    expect(slugifyTitle("!! Critical bug")).toBe("critical-bug");
  });
});

describe("buildBranchName", () => {
  it("joins issue number and slug with a single dash", () => {
    expect(buildBranchName(123, "fix-button")).toBe("123-fix-button");
  });

  it("handles large issue numbers", () => {
    expect(buildBranchName(9999, "slug")).toBe("9999-slug");
  });

  it("does not validate the slug — assumes slugifyTitle was already called", () => {
    // contract documentation: garbage in, garbage out
    expect(buildBranchName(1, "Bad Slug!")).toBe("1-Bad Slug!");
  });
});

describe("parseIssueFromBranch", () => {
  it("parses flat vibe-convention branches", () => {
    expect(parseIssueFromBranch("123-fix-button")).toBe(123);
    expect(parseIssueFromBranch("4567-some-long-slug")).toBe(4567);
  });

  it("returns null for prefixed branches (those use a different resolver)", () => {
    expect(parseIssueFromBranch("fix/123-foo")).toBeNull();
    expect(parseIssueFromBranch("kody/vibe-123-foo")).toBeNull();
  });

  it("returns null for branches with fewer than 3 leading digits", () => {
    expect(parseIssueFromBranch("12-foo")).toBeNull();
    expect(parseIssueFromBranch("1-foo")).toBeNull();
  });

  it("returns null for branches without a trailing slug", () => {
    expect(parseIssueFromBranch("123")).toBeNull();
  });

  it("returns null for non-numeric prefixes", () => {
    expect(parseIssueFromBranch("main")).toBeNull();
    expect(parseIssueFromBranch("foo-bar")).toBeNull();
  });
});
