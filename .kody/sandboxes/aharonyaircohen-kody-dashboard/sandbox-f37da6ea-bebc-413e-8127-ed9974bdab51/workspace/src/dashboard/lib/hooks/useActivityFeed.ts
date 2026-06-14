/**
 * @fileType hook
 * @domain kody
 * @pattern use-activity-feed
 * @ai-summary Fetches the Activity Feed (engine + chat events). Gated by
 *   `enabled` so it only fires when the Feed tab is actually open, and has
 *   NO `refetchInterval` — refresh is manual. This keeps the event-log read
 *   off the steady-state GitHub budget (CLAUDE.md rate-limit rules); the
 *   server side adds a 60s cache on top.
 */
import { useQuery } from "@tanstack/react-query";
import { kodyApi } from "../api";

export const activityFeedQueryKeys = {
  feed: ["activity", "feed"] as const,
};

export function useActivityFeed(enabled: boolean) {
  return useQuery({
    queryKey: activityFeedQueryKeys.feed,
    queryFn: () => kodyApi.activity.feed(),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}
