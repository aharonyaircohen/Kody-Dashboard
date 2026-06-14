/**
 * @fileType hook
 * @domain kody
 * @pattern usePRBehind
 * @ai-summary Polls how many commits a PR's head branch is behind its base.
 * Used to gate the Preview "Sync" button — when 0, branch is up to date.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { prsApi, getStoredAuth } from "../api";

const BEHIND_POLL_MS = 30_000;

export function usePRBehind(prNumber: number | undefined) {
  return useQuery({
    queryKey: ["pr-behind", prNumber],
    queryFn: () => prsApi.behind(prNumber!),
    enabled: !!getStoredAuth() && !!prNumber,
    refetchInterval: BEHIND_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });
}
