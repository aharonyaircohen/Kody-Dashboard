/**
 * @fileType hook
 * @domain kody
 * @pattern github-identity
 * @ai-summary Hook for the authenticated GitHub identity. Auth is entirely
 *   header-based PAT (localStorage `kody_auth` → `x-kody-token` header on
 *   every API call). This hook fetches `/api/kody/auth/me`, which resolves
 *   the identity by hitting GitHub with the current request's token. There
 *   is no server-side session cookie.
 */
'use client'

import { useCallback, useEffect } from 'react'
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
 * - `clearGitHubUser()` signs out: clears cookie and navigates to login.
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

  // Invalidate cache whenever kody_auth changes in localStorage.
  // This keeps the React Query cache in sync with the localStorage source of truth,
  // so logout takes effect immediately without a full page reload.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const stored = localStorage.getItem('kody_auth')
    const hasAuth = stored !== null && stored !== 'null'

    if (!hasAuth) {
      // localStorage is empty — clear the cache so githubUser becomes null immediately
      queryClient.setQueryData(QUERY_KEY, null)
    }
  }, [queryClient])

  // No-op: identity is set by OAuth flow, not manually
  const setGitHubUser = useCallback(() => {
    // Identity is managed by OAuth session — use clearGitHubUser() to sign out
  }, [])

  const clearGitHubUser = useCallback(async () => {
    // No server-side session anymore — auth lives entirely in localStorage.
    // Drop the stored creds and the React Query cache, then hard-redirect so
    // the AuthGuard re-renders against the empty store.
    localStorage.removeItem('kody_auth')
    queryClient.setQueryData(QUERY_KEY, null)
    queryClient.removeQueries({ queryKey: QUERY_KEY })
    // Hard navigation so AuthProvider re-reads localStorage and all React Query
    // caches holding authenticated data are dropped. The root route's AuthGuard
    // then renders the RepoManager empty-state since `kody_auth` is gone.
    if (typeof window !== 'undefined') {
      window.location.href = '/'
    }
  }, [queryClient])

  return { githubUser, connectedRepo, authError, isLoaded, setGitHubUser, clearGitHubUser }
}
