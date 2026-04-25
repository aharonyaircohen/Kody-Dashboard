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
    // Poll every 15s while CI is running/pending, slow-poll on failure for recovery, stop on success
    refetchInterval: (query) => {
      const status = query.state.data?.ciStatus
      if (status === 'running' || status === 'pending') return 15_000
      if (status === 'failure') return 30_000 // Slow recovery poll — CI may be re-run
      return false // 'success' — settled, stop polling
    },
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  })
}
