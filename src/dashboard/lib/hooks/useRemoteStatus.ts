/**
 * @fileType hooks
 * @domain kody
 * @pattern custom-hooks
 * @ai-summary React Query hook for polling remote dev agent status
 */
'use client'

import { useQuery } from '@tanstack/react-query'
import { kodyApi } from '../api'
import type { RemoteStatus } from '../api'

/**
 * Poll the remote dev agent status every 30 seconds.
 * Returns { configured, online, funnelUrl } or null when actorLogin is not provided.
 */
export function useRemoteStatus(actorLogin?: string | null) {
  return useQuery<RemoteStatus>({
    queryKey: ['remote-status', actorLogin],
    queryFn: () => kodyApi.remote.status(actorLogin!),
    enabled: !!actorLogin,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 25_000,
    // Don't throw — offline is a valid state
    retry: 1,
  })
}
