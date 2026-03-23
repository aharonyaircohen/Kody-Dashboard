/**
 * @fileType hook
 * @domain kody
 * @pattern github-identity
 * @ai-summary Hook to read the authenticated GitHub identity from the Kody session cookie.
 *   Replaces the localStorage-based "Who are you?" picker with verified GitHub OAuth identity.
 *   The session is set server-side by /api/oauth/github/callback.
 *   signOut() logs out (clears session cookie) and shows the login screen.
 */
'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export interface GitHubIdentity {
  login: string
  avatar_url: string
  githubId?: number
}

interface MeResponse {
  authenticated: boolean
  user?: GitHubIdentity
}

const QUERY_KEY = ['kody-github-identity']

async function fetchIdentity(): Promise<GitHubIdentity | null> {
  const res = await fetch('/api/kody/auth/me', { credentials: 'include' })
  if (!res.ok) return null
  const data = (await res.json()) as MeResponse
  return data.authenticated && data.user ? data.user : null
}

/**
 * Returns the verified GitHub identity from the Kody session.
 *
 * - `githubUser` is `null` when not authenticated (session missing or expired).
 * - `isLoaded` is `false` while the initial fetch is in progress.
 * - `setGitHubUser` is a no-op (identity is set by OAuth, not manually).
 * - `clearGitHubUser()` signs out: clears cookie and shows login screen (no auto-redirect).
 */
export function useGitHubIdentity() {
  const queryClient = useQueryClient()

  const { data: githubUser = null, isLoading } = useQuery<GitHubIdentity | null>({
    queryKey: QUERY_KEY,
    queryFn: fetchIdentity,
    staleTime: 5 * 60 * 1000, // 5 minutes — session is stable within a visit
    retry: false,
  })

  const isLoaded = !isLoading

  // No-op: identity is set by OAuth flow, not manually
  const setGitHubUser = useCallback(() => {
    // Identity is managed by OAuth session — use clearGitHubUser() to sign out
  }, [])

  const clearGitHubUser = useCallback(async () => {
    // Clear session cookie server-side
    try {
      await fetch('/api/kody/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // Ignore errors — cookie may already be cleared
    }
    // Invalidate cached identity — UI will show the login screen
    queryClient.setQueryData(QUERY_KEY, null)
  }, [queryClient])

  return { githubUser, isLoaded, setGitHubUser, clearGitHubUser }
}
