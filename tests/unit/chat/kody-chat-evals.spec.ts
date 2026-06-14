/**
 * Deterministic chat evals for Kody behavior.
 *
 * These do not call a model. They pin the rules that made recent bad
 * conversations fail: fake issue links, noisy clarifying questions, and
 * over-complicated prompt guidance.
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../../app/api/kody/chat/kody/system-prompt";
import { loadChatDefaults, composeBasePrompt } from "@dashboard/lib/chat-defaults";
import { getCreatedIssueNumberFromToolOutput } from "@dashboard/lib/components/kody-chat-types";

const prompt = buildSystemPrompt(
  composeBasePrompt(
    await loadChatDefaults("acme", "repo"),
  ),
  { owner: "acme", repo: "repo" },
  undefined,
  { vibeMode: true, flyConfigured: false },
);

describe("Kody chat evals", () => {
  it("does not count read-tool issue URLs as newly created issues", () => {
    const existingIssue = {
      number: 77,
      url: "https://github.com/acme/repo/issues/77",
    };

    expect(
      getCreatedIssueNumberFromToolOutput("github_get_issue", existingIssue),
    ).toBeNull();
  });

  it("does not count failed create tools as created issues", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_feature", {
        error: "Validation Failed",
      }),
    ).toBeNull();
  });

  it("allows create_task to transfer chat scope after real creation", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_task", {
        number: 88,
        url: "https://github.com/acme/repo/issues/88",
      }),
    ).toBe(88);
  });

  it("tells Kody to ask at most one blocking clarifying question", () => {
    expect(prompt).toContain("Ask at most one clarifying question");
    expect(prompt).toContain("Do not ask about wording, naming, priority");
  });

  it("does not encourage endless clarification loops in Vibe mode", () => {
    expect(prompt).not.toContain("Ask in small batches");
    expect(prompt).not.toContain("repeat. Stop ONLY");
  });
});

describe("Kody chat evals", () => {
  it("does not count read-tool issue URLs as newly created issues", () => {
    const existingIssue = {
      number: 77,
      url: "https://github.com/acme/repo/issues/77",
    };

    expect(
      getCreatedIssueNumberFromToolOutput("github_get_issue", existingIssue),
    ).toBeNull();
  });

  it("does not count failed create tools as created issues", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_feature", {
        error: "Validation Failed",
      }),
    ).toBeNull();
  });

  it("allows create_task to transfer chat scope after real creation", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_task", {
        number: 88,
        url: "https://github.com/acme/repo/issues/88",
      }),
    ).toBe(88);
  });

  it("tells Kody to ask at most one blocking clarifying question", () => {
    expect(prompt).toContain("Ask at most one clarifying question");
    expect(prompt).toContain("Do not ask about wording, naming, priority");
  });

  it("does not encourage endless clarification loops in Vibe mode", () => {
    expect(prompt).not.toContain("Ask in small batches");
    expect(prompt).not.toContain("repeat. Stop ONLY");
  });
});
