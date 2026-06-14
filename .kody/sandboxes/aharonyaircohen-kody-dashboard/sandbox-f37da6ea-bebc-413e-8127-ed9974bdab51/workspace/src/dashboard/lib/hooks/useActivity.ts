/**
 * @fileType hook
 * @domain kody
 * @pattern use-activity
 * @ai-summary Polls the Engine Activity snapshot. 30s interval — above the
 *   15s rate-limit floor, and the underlying route reads the shared cached
 *   workflow-run data so this poll is effectively free.
 */
import { useQuery } from "@tanstack/react-query";
import { kodyApi } from "../api";

export const activityQueryKeys = {
  snapshot: ["activity", "snapshot"] as const,
};

const POLL_MS = 30_000;

export function useActivity() {
  return useQuery({
    queryKey: activityQueryKeys.snapshot,
    queryFn: () => kodyApi.activity.get(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: POLL_MS,
  });
}
