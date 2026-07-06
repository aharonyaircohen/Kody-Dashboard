/**
 * @fileType hook
 * @domain kody
 * @pattern agency-runs-query
 * @ai-summary React Query hook for the AI Agency run monitor.
 */
import { useQuery } from "@tanstack/react-query";

import { kodyApi } from "../api";
import { useAuth, type KodyAuth } from "../auth-context";

function scope(auth: KodyAuth | null) {
  if (!auth) return "no-auth";
  return {
    owner: auth.owner,
    repo: auth.repo,
    storeRepoUrl: auth.storeRepoUrl ?? null,
    storeRef: auth.storeRef ?? null,
  };
}

export const agencyRunsQueryKeys = {
  all: ["kody-agency-runs"] as const,
  list: (auth: KodyAuth | null) =>
    [...agencyRunsQueryKeys.all, scope(auth)] as const,
  detail: (
    auth: KodyAuth | null,
    sourcePath: string | null,
    githubRunId: string | null,
  ) =>
    [
      ...agencyRunsQueryKeys.all,
      scope(auth),
      "detail",
      sourcePath,
      githubRunId,
    ] as const,
};

export function useAgencyRuns() {
  const { auth } = useAuth();
  return useQuery({
    queryKey: agencyRunsQueryKeys.list(auth),
    queryFn: () => kodyApi.agencyRuns.list(),
    enabled: !!auth,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useAgencyRunDetail(
  sourcePath: string | null,
  githubRunId: string | null = null,
) {
  const { auth } = useAuth();
  return useQuery({
    queryKey: agencyRunsQueryKeys.detail(auth, sourcePath, githubRunId),
    queryFn: () => kodyApi.agencyRuns.detail(sourcePath ?? "", githubRunId),
    enabled: !!auth && !!sourcePath,
    staleTime: 30_000,
  });
}
