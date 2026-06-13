/**
 * @fileType hook
 * @domain kody
 * @pattern closed-goal-tasks-hook
 * @ai-summary On-demand fetch of closed issues for a single goal label.
 *   Only enabled when the user opens the goal's "Show closed" toggle, so
 *   the main task polling stays cheap.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  kodyApi,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const closedGoalTasksQueryKey = (goalId: string) =>
  ["kody-tasks", "closed", goalId] as const;

export function useClosedGoalTasks(goalId: string, enabled: boolean) {
  return useQuery({
    queryKey: closedGoalTasksQueryKey(goalId),
    queryFn: () => kodyApi.tasks.listClosedForGoal(goalId),
    enabled: enabled && !!getStoredAuth(),
    staleTime: 60_000,
    // Closed tasks rarely change — no aggressive polling.
    refetchInterval: false,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}
