/**
 * @fileType hook
 * @domain kody
 * @pattern useDefaultBranchCI
 * @ai-summary Polls the connected repo's default-branch CI roll-up for the
 *   dashboard banner. 30s cadence matches the goals/notifications poll —
 *   well within the ≥15s rule from CLAUDE.md, and the server-side cache
 *   collapses concurrent calls.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  kodyApi,
  type DefaultBranchCI,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const defaultBranchCIQueryKey = ["kody-ci-main"] as const;

export function useDefaultBranchCI() {
  return useQuery<DefaultBranchCI>({
    queryKey: defaultBranchCIQueryKey,
    queryFn: () => kodyApi.ci.main(),
    enabled: !!getStoredAuth(),
    staleTime: 25_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}
