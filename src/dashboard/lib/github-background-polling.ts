const ISSUE_TASK_ROUTES = new Set([
  "/",
  "/tasks",
  "/new",
  "/bug",
  "/report-kody-bug",
]);

function normalizePathname(pathname: string | null | undefined): string {
  if (!pathname) return "";
  return pathname.replace(/\/+$/, "") || "/";
}

export function routeShowsGitHubIssuesOrTasks(
  pathname: string | null | undefined,
): boolean {
  const path = normalizePathname(pathname);
  return (
    ISSUE_TASK_ROUTES.has(path) ||
    path === "/vibe" ||
    path.startsWith("/vibe/") ||
    /^\/\d+(?:\/|$)/.test(path)
  );
}

export function routeShowsInbox(pathname: string | null | undefined): boolean {
  const path = normalizePathname(pathname);
  return path === "/inbox" || path.startsWith("/inbox/");
}

export function routeShowsMessages(
  pathname: string | null | undefined,
): boolean {
  const path = normalizePathname(pathname);
  return path === "/messages" || path.startsWith("/messages/");
}

export function routeShowsReports(
  pathname: string | null | undefined,
): boolean {
  const path = normalizePathname(pathname);
  return path === "/reports" || path.startsWith("/reports/");
}

export function shouldPollChatGoalsForRoute(
  pathname: string | null | undefined,
): boolean {
  return routeShowsGitHubIssuesOrTasks(pathname);
}

export function shouldPollInboxFeedForRoute(
  pathname: string | null | undefined,
): boolean {
  return routeShowsGitHubIssuesOrTasks(pathname) || routeShowsInbox(pathname);
}

export function shouldEnableSidebarInboxBadgeData(
  pathname: string | null | undefined,
): boolean {
  return routeShowsGitHubIssuesOrTasks(pathname) || routeShowsInbox(pathname);
}

export function shouldEnableSidebarMessagesBadgeData(
  pathname: string | null | undefined,
): boolean {
  return (
    routeShowsGitHubIssuesOrTasks(pathname) || routeShowsMessages(pathname)
  );
}

export function shouldEnableSidebarReportsBadgeData(
  pathname: string | null | undefined,
): boolean {
  return routeShowsGitHubIssuesOrTasks(pathname) || routeShowsReports(pathname);
}
