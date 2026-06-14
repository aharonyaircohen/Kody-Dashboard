/**
 * @fileType hook
 * @domain kody
 * @pattern use-autonomous-activity
 * @ai-summary Fetches Kody's autonomous work product (recent PRs) for the
 *   Activity → Auto tab. Server-side it's the cached `fetchRecentPRs`
 *   GraphQL query (5min TTL + dedup + stale fallback), so a 60s poll is
 *   mostly cache hits and stays within the rate-limit rules.
 */
import { useQuery } from "@tanstack/react-query";
import { kodyApi } from "../api";

export const autonomousActivityQueryKeys = {
  autonomous: ["activity", "autonomous"] as const,
};

const POLL_MS = 60_000;

export function useAutonomousActivity(enabled: boolean) {
  return useQuery({
    queryKey: autonomousActivityQueryKeys.autonomous,
    queryFn: () => kodyApi.activity.autonomous(),
    enabled,
    refetchInterval: enabled ? POLL_MS : false,
    refetchOnWindowFocus: true,
    staleTime: POLL_MS,
  });
}
