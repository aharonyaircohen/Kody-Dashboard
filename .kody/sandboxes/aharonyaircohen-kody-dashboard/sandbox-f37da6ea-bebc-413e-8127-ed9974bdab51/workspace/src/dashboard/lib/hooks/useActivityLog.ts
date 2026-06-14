/**
 * @fileType hook
 * @domain kody
 * @pattern use-activity-log
 * @ai-summary Polls the dashboard audit log. The endpoint merges this
 *   instance's in-memory ring with the durable audit-log manifest issue,
 *   read through the cached/ETag path — so a 30s poll mostly hits cache or
 *   a free 304 and stays within the ≥15s rate-limit rule.
 */
import { useQuery } from "@tanstack/react-query";
import { kodyApi } from "../api";

export const activityLogQueryKeys = {
  log: ["activity", "log"] as const,
};

const POLL_MS = 30_000;

export function useActivityLog(enabled: boolean) {
  return useQuery({
    queryKey: activityLogQueryKeys.log,
    queryFn: () => kodyApi.activity.log(),
    enabled,
    refetchInterval: enabled ? POLL_MS : false,
    refetchOnWindowFocus: true,
    staleTime: POLL_MS,
  });
}
