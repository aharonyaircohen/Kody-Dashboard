/**
 * @fileType hook
 * @domain kody
 * @pattern use-health
 * @ai-summary Polls the upstream Health report for the Activity Health banner.
 *   30s interval — above the 15s rate-limit floor; the route's probes are all
 *   cached / free-endpoint, so this poll is effectively free (CLAUDE.md rules).
 */
import { useQuery } from "@tanstack/react-query";
import { kodyApi } from "../api";

export const healthQueryKeys = {
  report: ["health", "report"] as const,
};

const POLL_MS = 30_000;

export function useHealth() {
  return useQuery({
    queryKey: healthQueryKeys.report,
    queryFn: () => kodyApi.activity.health(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: POLL_MS,
  });
}
