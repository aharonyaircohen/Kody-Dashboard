import { describe, expect, it, vi } from "vitest";
import {
  normalizeAgentSlug,
  slugifyAgentTitle,
} from "../../src/dashboard/lib/agent-slug";
import { normalizeSlug, slugifyTitle } from "../../src/dashboard/lib/slug";

describe("agent slug normalization", () => {
  it("normalizes normal titles into valid slugs", () => {
    expect(slugifyAgentTitle("Release Notes Manager")).toBe(
      "release-notes-manager",
    );
    expect(slugifyAgentTitle("QA: smoke_check!!")).toBe("qa-smoke_check");
    expect(slugifyAgentTitle("__QA agent__")).toBe("qa-agent");
  });

  it("bounds slugs to the agent file limit", () => {
    expect(slugifyAgentTitle("a".repeat(80))).toHaveLength(64);
  });

  it("generates a valid fallback for non-ascii-only titles", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_787_000_000_000);

    expect(normalizeAgentSlug("סוכן בדיקות")).toMatch(
      /^agent-[a-z0-9]+$/,
    );
  });
});

describe("shared slug normalization", () => {
  it("is reusable outside agents", () => {
    expect(slugifyTitle("Company Profile")).toBe("company-profile");
    expect(normalizeSlug("חברה", "context")).toMatch(/^context-[a-z0-9]+$/);
  });
});
