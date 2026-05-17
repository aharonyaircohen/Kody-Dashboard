/**
 * @fileType hook
 * @domain kody
 * @pattern use-activity-log
 * @ai-summary Polls the dashboard-native action log. The endpoint is a
 *   pure in-memory read (no GitHub calls), so a 30s poll is free and safe
 *   — no rate-limit concern, unlike the run/feed paths.
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
