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
  owner?: string
  repo?: string
  error?: string
}

const QUERY_KEY = ['kody-github-identity']

function buildHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem('kody_auth')
    if (!raw) return {}
    const auth = JSON.parse(raw) as { token?: string; owner?: string; repo?: string }
    if (!auth.token || !auth.owner || !auth.repo) return {}
    return {
      'x-kody-token': auth.token,
      'x-kody-owner': auth.owner,
      'x-kody-repo': auth.repo,
    }
  } catch {
    return {}
  }
}

async function fetchIdentity(): Promise<{ identity: GitHubIdentity | null; repo: string | null; error: string | null }> {
  const headers = buildHeaders()
  const res = await fetch('/api/kody/auth/me', {
    headers,
    credentials: 'include',
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as MeResponse
    return { identity: null, repo: null, error: data.error ?? `Error ${res.status}` }
  }
  const data = (await res.json()) as MeResponse
  return {
    identity: data.authenticated && data.user ? data.user : null,
    repo: data.repo ?? null,
    error: data.error ?? null,
  }
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

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchIdentity,
    staleTime: 5 * 60 * 1000, // 5 minutes — session is stable within a visit
    retry: false,
  })

  const githubUser = data?.identity ?? null
  const connectedRepo = data?.repo ?? null
  const authError = data?.error ?? null
  const isLoaded = !isLoading

  // No-op: identity is set by OAuth flow, not manually
  const setGitHubUser = useCallback(() => {
    // Identity is managed by OAuth session — use clearGitHubUser() to sign out
  }, [])

  const clearGitHubUser = useCallback(async () => {
    // Clear session cookie server-side (for legacy OAuth sessions)
    try {
      await fetch('/api/kody/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // Ignore errors — cookie may already be cleared
    }
    // Clear the new localStorage-based auth token
    if (typeof window !== 'undefined') {
      localStorage.removeItem('kody_auth')
    }
    // Invalidate cached identity — UI will show the login screen
    queryClient.setQueryData(QUERY_KEY, null)
    // Redirect to login page
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
  }, [queryClient])

  return { githubUser, connectedRepo, authError, isLoaded, setGitHubUser, clearGitHubUser }
}
