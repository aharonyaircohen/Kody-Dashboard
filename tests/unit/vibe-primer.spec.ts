/**
 * @fileoverview Unit tests for the vibe primer — the server-only instruction
 * block prepended to the user's message so the runner knows whether to start
 * fresh (create issue/branch/PR) or push onto an existing vibe branch.
 * @testFramework vitest
 * @domain vibe
 *
 * The primer is pure string logic but it is load-bearing: it is the only
 * thing that tells the ephemeral runner to COMMIT + PUSH (otherwise the PR
 * stays empty — the historical "everything succeeds, nothing changed" bug),
 * and it is what stops the runner from cutting a SECOND branch and splitting
 * the work across two PRs. These assertions pin the contract the runner
 * relies on without booting a runner.
 */

import { describe, expect, it } from "vitest";
import {
  buildVibePrimer,
  applyVibePrimerToMessages,
  applyVibePrimerToContent,
  type ChatMessage,
} from "@dashboard/lib/vibe/primer";

describe("buildVibePrimer — fresh (no taskContext)", () => {
  const primer = buildVibePrimer(undefined);

  it("instructs the runner to create a NEW issue + branch + PR", () => {
    expect(primer).toContain("No issue is selected");
    expect(primer).toContain("gh issue create");
    expect(primer).toContain("Closes #<issue-number>");
  });

  it("enforces the plan-then-confirm gate before editing", () => {
    expect(primer).toMatch(/Do NOT start editing files until I confirm/i);
  });

  it("carries the mandatory commit/push rule", () => {
    expect(primer).toContain("never end a turn with uncommitted changes");
    expect(primer).toContain("Your reply MUST cite the commit SHA");
  });

  it("keeps session and event state out of the feature branch contract", () => {
    expect(primer).toContain("git add -A");
    expect(primer).toContain("Kody session and event state");
    expect(primer).toContain("external state repo");
  });
});

describe("buildVibePrimer — follow-up with a pinned branch", () => {
  const primer = buildVibePrimer({
    issueNumber: 42,
    prNumber: 101,
    branch: "42-fix-the-thing",
  });

  it("hard-pins the existing branch and forbids creating a new one", () => {
    expect(primer).toContain("Use the existing branch `42-fix-the-thing`");
    expect(primer).toMatch(/Do NOT create a new issue or a new branch/i);
    // When the branch is known, it must NOT fall back to gh-pr-list discovery.
    expect(primer).not.toContain("gh pr list");
  });

  it("references the issue and PR numbers it is iterating on", () => {
    expect(primer).toContain("issue #42");
    expect(primer).toContain("PR #101");
  });

  it("allows skipping the confirm gate when the message says the plan was approved", () => {
    expect(primer).toMatch(/the plan was approved in the previous chat/i);
  });

  it("still carries the commit/push rule on follow-ups", () => {
    expect(primer).toContain("never end a turn with uncommitted changes");
  });
});

describe("buildVibePrimer — follow-up WITHOUT a known branch", () => {
  const primer = buildVibePrimer({ issueNumber: 7 });

  it("tells the runner to discover the existing vibe branch via gh pr list, not cut a new one", () => {
    expect(primer).toContain('gh pr list --search "Closes #7"');
    expect(primer).toContain("do NOT create a new one");
    expect(primer).toContain("headRefName");
  });

  it("instructs the runner to stop if no matching vibe PR exists (rather than fork work)", () => {
    expect(primer).toContain("no vibe branch was pre-created");
  });

  it("omits a PR-number hint when none was provided", () => {
    expect(primer).not.toContain("PR #");
  });
});

describe("applyVibePrimerToMessages", () => {
  function msg(role: "user" | "assistant", content: string): ChatMessage {
    return { role, content, timestamp: "2026-01-01T00:00:00Z" };
  }

  it("prepends the primer to the LAST user message only", () => {
    const messages = [
      msg("user", "first turn"),
      msg("assistant", "reply"),
      msg("user", "second turn"),
    ];
    const out = applyVibePrimerToMessages(messages, undefined);

    // Earlier turns are untouched.
    expect(out[0].content).toBe("first turn");
    expect(out[1].content).toBe("reply");
    // The last user turn carries the primer + the original text.
    expect(out[2].content).toContain("[Vibe mode");
    expect(out[2].content.endsWith("second turn")).toBe(true);
  });

  it("uses the follow-up variant when a taskContext is supplied", () => {
    const out = applyVibePrimerToMessages([msg("user", "tweak the header")], {
      issueNumber: 9,
      branch: "9-header",
    });
    expect(out[0].content).toContain("Use the existing branch `9-header`");
    expect(out[0].content.endsWith("tweak the header")).toBe(true);
  });

  it("is a no-op on an empty message list", () => {
    expect(applyVibePrimerToMessages([], undefined)).toEqual([]);
  });

  it("is a no-op when there is no user message to anchor on", () => {
    const onlyAssistant = [msg("assistant", "hi")];
    const out = applyVibePrimerToMessages(onlyAssistant, undefined);
    expect(out[0].content).toBe("hi");
  });
});

describe("applyVibePrimerToContent", () => {
  it("prepends the primer and preserves the user content verbatim at the end", () => {
    const out = applyVibePrimerToContent("ship it", {
      issueNumber: 5,
      branch: "5-ship",
    });
    expect(out).toContain("Use the existing branch `5-ship`");
    expect(out.endsWith("ship it")).toBe(true);
  });

  it("uses the fresh variant when no taskContext is given", () => {
    const out = applyVibePrimerToContent("build something new", undefined);
    expect(out).toContain("No issue is selected");
    expect(out.endsWith("build something new")).toBe(true);
  });
});
