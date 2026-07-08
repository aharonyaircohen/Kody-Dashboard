import { describe, expect, it } from "vitest";

import { applyVibeToolPolicy } from "../../app/api/kody/chat/kody/vibe-tool-policy";
import { DEFAULT_CHAT_CAPABILITY } from "@dashboard/lib/chat-defaults/defaults";

describe("Kody chat tool policy", () => {
  it("keeps issue execution available while blocking PR and write starters", () => {
    const tools = applyVibeToolPolicy(
      {
        kody_run_issue: {},
        kody_fix_pr: {},
        remote_write: {},
        create_enhancement: {},
      },
      { vibeMode: true, hasCurrentTask: false },
    );

    expect(tools).toHaveProperty("kody_run_issue");
    expect(tools).toHaveProperty("create_enhancement");
    expect(tools).not.toHaveProperty("kody_fix_pr");
    expect(tools).not.toHaveProperty("remote_write");
  });

  it("keeps issue execution when a task is selected but removes duplicate issue creation", () => {
    const tools = applyVibeToolPolicy(
      {
        kody_run_issue: {},
        create_enhancement: {},
        report_bug: {},
      },
      { vibeMode: true, hasCurrentTask: true },
    );

    expect(tools).toHaveProperty("kody_run_issue");
    expect(tools).not.toHaveProperty("create_enhancement");
    expect(tools).not.toHaveProperty("report_bug");
  });

  it("exposes issue execution in the default chat allowlist", () => {
    expect(DEFAULT_CHAT_CAPABILITY.tools).toContain("kody_run_issue");
  });
});
