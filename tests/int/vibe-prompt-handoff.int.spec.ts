/**
 * @fileoverview Vibe prompt boundary: Kody chat creates/refines issues only.
 * @testFramework vitest
 * @domain vibe
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../app/api/kody/chat/kody/system-prompt";

const REPO = { owner: "acme", repo: "widgets" } as const;

describe("vibe system prompt — issue-only boundary", () => {
  it("does not instruct runner handoff for an already-selected task", () => {
    const prompt = buildSystemPrompt(
      "You are Kody.",
      REPO,
      {
        issueNumber: 42,
        title: "Update homepage welcome text",
        state: "open",
        labels: ["enhancement"],
      },
      { vibeMode: true, flyConfigured: true },
    );

    expect(prompt).toMatch(/issue \*\*already exists\*\*/i);
    expect(prompt).toMatch(/do not start work from chat/i);
    expect(prompt).toMatch(/do not open a draft PR/i);
    expect(prompt).not.toMatch(/targetAgent|Runner availability/i);
  });

  it("fresh vibe flow ends after issue creation", () => {
    const prompt = buildSystemPrompt("You are Kody.", REPO, undefined, {
      vibeMode: true,
      flyConfigured: false,
    });

    expect(prompt).toMatch(/Stop after issue creation/i);
    expect(prompt).toMatch(/Reply with the issue number, title, and URL/i);
  });
});
