/**
 * @fileoverview Regression tests for Kody chat's issue-first tool boundary.
 * @testFramework vitest
 * @domain kody
 */
import { describe, expect, it } from "vitest";
import {
  applyVibeToolPolicy,
  KODY_CHAT_IMPLEMENTATION_TOOLS,
  VIBE_CREATE_TOOLS,
} from "../../app/api/kody/chat/kody/vibe-tool-policy";

function sampleTools(): Record<string, string> {
  return {
    create_feature: "t",
    create_enhancement: "t",
    create_refactor: "t",
    create_documentation: "t",
    create_chore: "t",
    report_bug: "t",
    create_task: "t",
    kody_run_issue: "t",
    kody_fix_pr: "t",
    request_release: "t",
    vibe_start_execution: "t",
    remote_exec: "t",
    remote_write: "t",
    remote_read: "t",
    remote_ls: "t",
    fetch_url: "t",
    github_get_file: "t",
  };
}

describe("applyVibeToolPolicy", () => {
  it("removes implementation-start tools for Kody chat in every mode", () => {
    for (const vibeMode of [true, false]) {
      const out = applyVibeToolPolicy(sampleTools(), {
        vibeMode,
        hasCurrentTask: false,
      });

      for (const name of KODY_CHAT_IMPLEMENTATION_TOOLS) {
        expect(out[name], `${name} must not be exposed`).toBeUndefined();
      }
      expect(out.remote_read).toBeDefined();
      expect(out.remote_ls).toBeDefined();
    }
  });

  it("removes issue-creation tools in vibe when already scoped to a task", () => {
    const out = applyVibeToolPolicy(sampleTools(), {
      vibeMode: true,
      hasCurrentTask: true,
    });

    for (const name of VIBE_CREATE_TOOLS) {
      expect(
        out[name],
        `${name} would create a duplicate issue`,
      ).toBeUndefined();
    }
  });

  it("keeps issue-creation tools in vibe when no task is scoped yet", () => {
    const out = applyVibeToolPolicy(sampleTools(), {
      vibeMode: true,
      hasCurrentTask: false,
    });

    expect(out.create_enhancement).toBeDefined();
    expect(out.report_bug).toBeDefined();
  });

  it("does not mutate input map", () => {
    const input = sampleTools();
    applyVibeToolPolicy(input, { vibeMode: true, hasCurrentTask: true });
    expect(input.create_enhancement).toBe("t");
    expect(input.vibe_start_execution).toBe("t");
  });
});
