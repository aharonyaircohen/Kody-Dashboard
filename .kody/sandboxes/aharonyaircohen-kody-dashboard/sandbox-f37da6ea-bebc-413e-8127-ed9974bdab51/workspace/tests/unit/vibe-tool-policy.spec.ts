/**
 * @fileoverview Reproduction + regression test for the duplicate-issue bug.
 * @testFramework vitest
 * @domain vibe
 *
 * Bug (severe): in the two-turn vibe flow — create an issue in turn 1, then
 * "approve / implement it" in turn 2 while scoped to that issue — the model
 * sometimes calls a `create_*` tool AGAIN, filing a SECOND issue for the same
 * task, instead of just handing the existing one off to the runner.
 *
 * Root cause: the chat tool set still includes the issue-creation tools when
 * the chat is already scoped to a task, so nothing stops the model from
 * creating a duplicate. The fix removes those tools once a task is scoped, so
 * the only forward action is `vibe_start_execution` on the current issue.
 *
 * These tests pin the policy directly (pure function), so they're fast and
 * deterministic — no model, no network.
 */

import { describe, expect, it } from "vitest";
import {
  applyVibeToolPolicy,
  VIBE_CREATE_TOOLS,
  VIBE_DISPATCH_TOOLS,
} from "../../app/api/kody/chat/kody/vibe-tool-policy";

/** A representative tool map covering each policy-relevant group. */
function sampleTools(): Record<string, string> {
  return {
    // issue-creation
    create_feature: "t",
    create_enhancement: "t",
    create_refactor: "t",
    create_documentation: "t",
    create_chore: "t",
    report_bug: "t",
    create_task: "t",
    // @kody dispatch
    kody_run_issue: "t",
    kody_fix_pr: "t",
    request_release: "t",
    // vibe + neutral
    vibe_start_execution: "t",
    fetch_url: "t",
    github_get_file: "t",
  };
}

describe("applyVibeToolPolicy", () => {
  it("REMOVES issue-creation tools when vibe is scoped to a task (no duplicate issues)", () => {
    const out = applyVibeToolPolicy(sampleTools(), {
      vibeMode: true,
      hasCurrentTask: true,
    });
    for (const name of VIBE_CREATE_TOOLS) {
      expect(
        out[name],
        `${name} must be stripped when a vibe task is already selected — ` +
          "otherwise the model can file a duplicate issue on approve",
      ).toBeUndefined();
    }
    // The hand-off tool MUST remain so the model can still run the issue.
    expect(out.vibe_start_execution).toBeDefined();
    // Dispatch tools stay stripped in vibe regardless.
    for (const name of VIBE_DISPATCH_TOOLS) expect(out[name]).toBeUndefined();
  });

  it("KEEPS issue-creation tools in vibe when no task is scoped yet (fresh flow files the first issue)", () => {
    const out = applyVibeToolPolicy(sampleTools(), {
      vibeMode: true,
      hasCurrentTask: false,
    });
    expect(out.create_enhancement).toBeDefined();
    expect(out.report_bug).toBeDefined();
    expect(out.vibe_start_execution).toBeDefined();
    // Dispatch tools still stripped in vibe.
    expect(out.kody_run_issue).toBeUndefined();
  });

  it("removes vibe_start_execution outside vibe, and keeps everything else", () => {
    const out = applyVibeToolPolicy(sampleTools(), {
      vibeMode: false,
      hasCurrentTask: true,
    });
    expect(out.vibe_start_execution).toBeUndefined();
    expect(out.create_enhancement).toBeDefined();
    expect(out.kody_run_issue).toBeDefined();
  });

  it("does not mutate the input map", () => {
    const input = sampleTools();
    applyVibeToolPolicy(input, { vibeMode: true, hasCurrentTask: true });
    expect(input.create_enhancement).toBe("t");
  });
});
