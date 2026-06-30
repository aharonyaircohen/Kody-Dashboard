import { describe, expect, it } from "vitest";

import {
  dashboardAgentUrl,
  dashboardCapabilityUrl,
  dashboardCommandUrl,
  dashboardContextUrl,
  dashboardFileUrl,
  dashboardInstructionsUrl,
  dashboardMemoryUrl,
  dashboardTaskUrl,
  dashboardTodoUrl,
} from "@dashboard/lib/thread-link";

describe("dashboard link helpers", () => {
  it("builds internal links for task and file resources", () => {
    expect(dashboardTaskUrl(123)).toBe("/123");
    expect(dashboardFileUrl("app/api/kody/tasks/route.ts")).toBe(
      "/files/app/api/kody/tasks/route.ts",
    );
    expect(dashboardFileUrl("docs/space name.md")).toBe(
      "/files/docs/space%20name.md",
    );
  });

  it("builds internal links for state-backed resources", () => {
    expect(dashboardMemoryUrl("reply-style")).toBe("/memory/reply-style");
    expect(dashboardContextUrl("release-rules")).toBe("/context/release-rules");
    expect(dashboardCapabilityUrl("fix-ci")).toBe("/capabilities/fix-ci");
    expect(dashboardTodoUrl("launch")).toBe("/todos/launch");
    expect(dashboardAgentUrl("qa")).toBe("/agents/qa");
    expect(dashboardCommandUrl("ship")).toBe("/commands");
    expect(dashboardInstructionsUrl()).toBe("/instructions");
  });
});
