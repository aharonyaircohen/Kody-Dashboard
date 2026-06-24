/**
 * @fileType hook
 * @domain kody
 * @pattern use-activity-run-logs
 * @ai-summary Fetches Activity -> Run Logs on demand from GitHub Actions
 *   artifacts. No polling; artifact downloads happen only when tab is open.
 */
import { useQuery } from "@tanstack/react-query";

import { kodyApi } from "../api";

export const activityRunLogsQueryKeys = {
  runLogs: ["activity", "run-logs"] as const,
};

export function useActivityRunLogs(enabled: boolean) {
  return useQuery({
    queryKey: activityRunLogsQueryKeys.runLogs,
    queryFn: () => kodyApi.activity.runLogs(),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}
