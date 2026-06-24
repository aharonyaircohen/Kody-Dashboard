/**
 * @fileType utility
 * @domain kody
 * @pattern task-visibility
 * @ai-summary Helpers for hiding GitHub issues from the dashboard task list.
 */
import { HIDDEN_TASK_LABEL, TASK_LIST_EXCLUDED_LABELS } from "../constants";
import { INBOX_FEED_ISSUE_TITLE, INBOX_FEED_START } from "../inbox/feed";

interface DashboardIssueVisibilityInput {
  labels: readonly string[];
  assignees?: readonly { login?: string | null }[] | null;
  isKodyAssigned?: boolean | null;
  title?: string | null;
  body?: string | null;
}

const DEFAULT_KODY_ASSIGNEE_LOGINS = ["kody"] as const;

export function isTaskHidden(labels: readonly string[] | null | undefined) {
  return labels?.some((label) => label === HIDDEN_TASK_LABEL) ?? false;
}

export function hasAnyKodyLabel(labels: readonly string[] | null | undefined) {
  return (
    labels?.some((label) => label.toLowerCase().startsWith("kody:")) ?? false
  );
}

export function isTaskListExcludedIssue(issue: DashboardIssueVisibilityInput) {
  if (
    issue.labels.some((label) =>
      TASK_LIST_EXCLUDED_LABELS.includes(
        label as (typeof TASK_LIST_EXCLUDED_LABELS)[number],
      ),
    )
  ) {
    return true;
  }
  return (
    issue.title === INBOX_FEED_ISSUE_TITLE ||
    (issue.body?.includes(INBOX_FEED_START) ?? false)
  );
}

export function isIssueAssignedToKody(
  issue: Pick<DashboardIssueVisibilityInput, "assignees" | "isKodyAssigned">,
  kodyAssigneeLogins: readonly string[] = DEFAULT_KODY_ASSIGNEE_LOGINS,
) {
  if (issue.isKodyAssigned) return true;

  const normalizedKodyLogins = new Set(
    kodyAssigneeLogins
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );

  if (normalizedKodyLogins.size === 0) return false;

  return (
    issue.assignees?.some((assignee) => {
      const login = assignee.login?.trim().toLowerCase();
      return !!login && normalizedKodyLogins.has(login);
    }) ?? false
  );
}

export function isDashboardKodyOwnedIssue(
  issue: DashboardIssueVisibilityInput,
  kodyAssigneeLogins: readonly string[] = DEFAULT_KODY_ASSIGNEE_LOGINS,
) {
  if (isTaskListExcludedIssue(issue)) return false;

  return (
    hasAnyKodyLabel(issue.labels) ||
    isIssueAssignedToKody(issue, kodyAssigneeLogins)
  );
}

export function isDashboardUnassignedIssue(
  issue: DashboardIssueVisibilityInput,
  kodyAssigneeLogins: readonly string[] = DEFAULT_KODY_ASSIGNEE_LOGINS,
) {
  if (isTaskListExcludedIssue(issue)) return false;
  return !isDashboardKodyOwnedIssue(issue, kodyAssigneeLogins);
}

export function isDashboardIntakeIssue(
  issue: DashboardIssueVisibilityInput,
  kodyAssigneeLogins: readonly string[] = DEFAULT_KODY_ASSIGNEE_LOGINS,
) {
  return (
    isDashboardKodyOwnedIssue(issue, kodyAssigneeLogins) ||
    isDashboardUnassignedIssue(issue, kodyAssigneeLogins)
  );
}

export function filterVisibleTasks<
  T extends {
    labels: readonly string[];
    title?: string | null;
    body?: string | null;
  },
>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => !isTaskListExcludedIssue(task));
}

export function markTaskHiddenInList<
  T extends { issueNumber: number; labels: string[] },
>(tasks: readonly T[], issueNumber: number): T[] {
  return tasks.map((task) => {
    if (task.issueNumber !== issueNumber) return task;
    if (task.labels.includes(HIDDEN_TASK_LABEL)) return task;
    return { ...task, labels: [...task.labels, HIDDEN_TASK_LABEL] };
  });
}

export function markTaskVisibleInList<
  T extends { issueNumber: number; labels: string[] },
>(tasks: readonly T[], issueNumber: number): T[] {
  return tasks.map((task) => {
    if (task.issueNumber !== issueNumber) return task;
    return {
      ...task,
      labels: task.labels.filter((label) => label !== HIDDEN_TASK_LABEL),
    };
  });
}
