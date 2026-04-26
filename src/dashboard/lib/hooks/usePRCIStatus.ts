/**
 * @fileType hook
 * @domain kody
 * @pattern usePRCIStatus
 * @ai-summary Hook to poll CI status for a PR using GitHub's mergeable_state
 */
'use client'

import { useQuery } from '@tanstack/react-query'
import { prsApi } from '../api'

export function usePRCIStatus(prNumber: number | undefined) {
  return useQuery({
    queryKey: ['pr-ci-status', prNumber],
    queryFn: () => prsApi.ciStatus(prNumber!),
    enabled: !!prNumber,
    // Poll cadence is matched to the server-side cache TTL (60s) — faster
    // polling just hits the in-memory cache and burns no GitHub quota, but
    // forces extra in-flight work and crowds the GraphQL bucket on cache
    // misses. CI runs take minutes, so 60s is plenty fresh.
    refetchInterval: (query) => {
      const status = query.state.data?.ciStatus
      if (status === 'running' || status === 'pending') return 60_000
      if (status === 'failure') return 120_000 // Slow recovery poll — CI may be re-run
      return false // 'success' — settled, stop polling
    },
    refetchIntervalInBackground: false,
    staleTime: 60_000,
  })
}
