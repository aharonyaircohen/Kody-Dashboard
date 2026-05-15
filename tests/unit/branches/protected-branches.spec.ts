import { describe, expect, it } from "vitest";
import {
  isProtectedBranch,
  PROTECTED_BRANCHES,
} from "@dashboard/lib/branches/domain/protected-branches";

describe("isProtectedBranch", () => {
  it("returns true for main, master, dev (the canonical set)", () => {
    expect(isProtectedBranch("main")).toBe(true);
    expect(isProtectedBranch("master")).toBe(true);
    expect(isProtectedBranch("dev")).toBe(true);
  });

  it("returns false for regular feature branches", () => {
    expect(isProtectedBranch("123-fix-button")).toBe(false);
    expect(isProtectedBranch("fix/login")).toBe(false);
    expect(isProtectedBranch("feature-x")).toBe(false);
  });

  it("matches case-insensitively to defend against UI/API mixed case", () => {
    expect(isProtectedBranch("MAIN")).toBe(true);
    expect(isProtectedBranch("Master")).toBe(true);
    expect(isProtectedBranch("DEV")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isProtectedBranch("")).toBe(false);
  });

  it("returns false for near-misses (substring / prefix)", () => {
    // these must not be protected — they are not the exact canonical names
    expect(isProtectedBranch("main-feature")).toBe(false);
    expect(isProtectedBranch("release/main")).toBe(false);
    expect(isProtectedBranch("develop")).toBe(false);
  });

  it("PROTECTED_BRANCHES contains exactly main, master, dev", () => {
    expect(new Set(PROTECTED_BRANCHES)).toEqual(
      new Set(["main", "master", "dev"]),
    );
  });
});
