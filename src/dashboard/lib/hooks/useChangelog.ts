/**
 * @fileType hook
 * @domain kody
 * @pattern changelog-hook
 * @ai-summary React Query hook for CHANGELOG.md from the connected repo.
 *   Read-only — file is maintained by webhook handlers on merge/release.
 */
"use client"

import { useQuery } from "@tanstack/react-query"
import {
  kodyApi,
  type ChangelogPayload,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api"

export const changelogQueryKey = ["kody-changelog"] as const

export function useChangelog() {
  return useQuery<ChangelogPayload>({
    queryKey: changelogQueryKey,
    queryFn: () => kodyApi.changelog.get(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false
      if (error instanceof NoTokenError) return false
      return failureCount < 2
    },
  })
}
