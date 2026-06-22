import { describe, expect, it } from "vitest";

import {
  routeShowsGitHubIssuesOrTasks,
  shouldEnableSidebarInboxBadgeData,
  shouldEnableSidebarMessagesBadgeData,
  shouldEnableSidebarReportsBadgeData,
  shouldPollChatGoalsForRoute,
  shouldPollInboxFeedForRoute,
} from "../../src/dashboard/lib/github-background-polling";

describe("github background polling route policy", () => {
  it("keeps CMS free of GitHub issue/task polling", () => {
    expect(routeShowsGitHubIssuesOrTasks("/cms")).toBe(false);
    expect(shouldPollChatGoalsForRoute("/cms")).toBe(false);
    expect(shouldPollInboxFeedForRoute("/cms")).toBe(false);
    expect(shouldEnableSidebarInboxBadgeData("/cms")).toBe(false);
    expect(shouldEnableSidebarMessagesBadgeData("/cms")).toBe(false);
    expect(shouldEnableSidebarReportsBadgeData("/cms")).toBe(false);
  });

  it("keeps live polling on routes that show task or issue data", () => {
    for (const route of ["/", "/tasks", "/vibe", "/123", "/123/comments"]) {
      expect(routeShowsGitHubIssuesOrTasks(route)).toBe(true);
      expect(shouldPollChatGoalsForRoute(route)).toBe(true);
      expect(shouldPollInboxFeedForRoute(route)).toBe(true);
      expect(shouldEnableSidebarInboxBadgeData(route)).toBe(true);
      expect(shouldEnableSidebarMessagesBadgeData(route)).toBe(true);
      expect(shouldEnableSidebarReportsBadgeData(route)).toBe(true);
    }
  });

  it("allows each dedicated communication route to fetch only its own badge data", () => {
    expect(shouldEnableSidebarInboxBadgeData("/inbox")).toBe(true);
    expect(shouldEnableSidebarMessagesBadgeData("/inbox")).toBe(false);
    expect(shouldEnableSidebarReportsBadgeData("/inbox")).toBe(false);

    expect(shouldEnableSidebarInboxBadgeData("/messages")).toBe(false);
    expect(shouldEnableSidebarMessagesBadgeData("/messages")).toBe(true);
    expect(shouldEnableSidebarReportsBadgeData("/messages")).toBe(false);

    expect(shouldEnableSidebarInboxBadgeData("/reports")).toBe(false);
    expect(shouldEnableSidebarMessagesBadgeData("/reports")).toBe(false);
    expect(shouldEnableSidebarReportsBadgeData("/reports")).toBe(true);
  });
});
