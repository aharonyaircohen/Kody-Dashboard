/**
 * @fileoverview Deterministic reproduction of the reported vibe bug:
 * "asked chat to create an issue, then on approving execution the session
 * was deleted and nothing happened."
 * @testFramework vitest
 * @domain vibe
 *
 * ROOT CAUSE (reproduced live, then pinned here): the vibe system prompt
 * only describes ONE shape of the flow — research → plan → (approve) →
 * `create_*` + `vibe_start_execution` in the SAME approval turn. It has no
 * path for "an issue is ALREADY selected and the user now wants to execute
 * it." So when the user creates the issue in one turn (landing on
 * /vibe?issue=N) and approves execution in a LATER turn while scoped to that
 * issue, the model finds the issue already exists, has no instruction to
 * call `vibe_start_execution` on it, and never hands off — the runner is
 * never dispatched ("nothing happened").
 *
 * This test asserts the prompt DOES carry that already-selected-task handoff
 * instruction. It fails on the buggy prompt and passes once the prompt gains
 * an explicit "execute the current task" path. The live counterpart is
 * tests/e2e/vibe-repro-session-deleted.spec.ts (real model, real GitHub).
 */

import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../app/api/kody/chat/kody/system-prompt";

const REPO = { owner: "acme", repo: "widgets" } as const;

describe("vibe system prompt — handoff when an issue is already selected", () => {
  it("instructs the model to call vibe_start_execution on the CURRENT task without creating a new issue", () => {
    // Scenario: user already created issue #42 in a prior turn and is now
    // scoped to it on /vibe?issue=42. This turn they say "approve / run it".
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

    // The prompt must tell the model: the issue ALREADY EXISTS — do NOT
    // create a new one; call vibe_start_execution on the selected issue.
    // The buggy prompt couples vibe_start_execution to issue CREATION
    // ("IMMEDIATELY after the create-issue tool succeeds") and never covers
    // the "issue already created/selected, now run it" case — so this
    // pattern is absent. The fix adds an explicit already-exists path.
    const scenarioPhrase =
      /already (been )?(created|selected|exists)|previously created|issue already|current task[\s\S]{0,160}(execute|run|implement)/i;
    const handoffNearScenario =
      /already (been )?(created|selected|exists)[\s\S]{0,300}vibe_start_execution/i.test(
        prompt,
      ) ||
      /vibe_start_execution[\s\S]{0,300}(already (been )?(created|selected|exists)|previously created)/i.test(
        prompt,
      );

    expect(
      scenarioPhrase.test(prompt) && handoffNearScenario,
      "vibe prompt must instruct calling vibe_start_execution on an ALREADY-CREATED/selected " +
        "task without creating a new issue — otherwise approving execution while scoped to an " +
        "existing issue (created in a prior turn) hands off to nothing (the 'nothing happened' bug)",
    ).toBe(true);
  });

  it("still keeps the create-then-execute flow for the no-issue-yet case", () => {
    // Regression guard: the fix must not remove the original single-turn
    // create+execute guidance.
    const fresh = buildSystemPrompt("You are Kody.", REPO, undefined, {
      vibeMode: true,
      flyConfigured: false,
    });
    expect(fresh).toContain("vibe_start_execution");
    expect(fresh).toMatch(/create_(feature|enhancement|chore)/);
  });
});
