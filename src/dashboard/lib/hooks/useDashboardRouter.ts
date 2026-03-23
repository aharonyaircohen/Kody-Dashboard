/**
 * @fileType hook
 * @domain kody
 * @pattern url-management
 * @ai-summary Custom hook for dashboard URL state management with pushState/popstate
 */
'use client'

import { useCallback, useEffect } from 'react'
import type { ViewMode } from '../components/FilterBar'

interface UseDashboardRouterOptions {
  /** Called when URL state changes */
  onStateChange?: (state: DashboardURLState) => void
}

interface DashboardURLState {
  issueNumber?: number
  tab?: string
  view?: ViewMode
  date?: string
  label?: string
  status?: string
  q?: string
  sort?: string
  dir?: 'asc' | 'desc'
  /** URL param name (different from internal name) */
  issue?: number
}

/**
 * Parse current URL search params into state object
 */
function parseURLState(): DashboardURLState {
  if (typeof window === 'undefined') return {}

  const params = new URLSearchParams(window.location.search)
  return {
    issueNumber: params.get('issue') ? parseInt(params.get('issue')!, 10) : undefined,
    tab: params.get('tab') || undefined,
    view: (params.get('view') as ViewMode) || undefined,
    date: params.get('date') || undefined,
    label: params.get('label') || undefined,
    status: params.get('status') || undefined,
    q: params.get('q') || undefined,
    sort: params.get('sort') || undefined,
    dir: (params.get('dir') as 'asc' | 'desc') || undefined,
  }
}

/**
 * Hook that encapsulates URL state management
 * This extracts ~80 lines of URL/pushState/popstate logic from KodyDashboard
 */
export function useDashboardRouter(options: UseDashboardRouterOptions = {}) {
  const { onStateChange } = options

  /**
   * Update URL with new state (without navigation)
   */
  const updateURL = useCallback(
    (updates: Partial<DashboardURLState>) => {
      if (typeof window === 'undefined') return

      const params = new URLSearchParams(window.location.search)

      // Apply updates
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          params.delete(key)
        } else {
          params.set(key, String(value))
        }
      })

      const newURL = `${window.location.pathname}?${params.toString()}`
      window.history.replaceState({}, '', newURL)

      // Notify listener
      onStateChange?.(parseURLState())
    },
    [onStateChange],
  )

  /**
   * Push new state to URL (with navigation)
   */
  const pushURL = useCallback(
    (updates: Partial<DashboardURLState>) => {
      if (typeof window === 'undefined') return

      const params = new URLSearchParams(window.location.search)

      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          params.delete(key)
        } else {
          params.set(key, String(value))
        }
      })

      const newURL = `${window.location.pathname}?${params.toString()}`
      window.history.pushState({}, '', newURL)

      onStateChange?.(parseURLState())
    },
    [onStateChange],
  )

  /**
   * Clear specific params from URL
   */
  const clearURLParams = useCallback(
    (keys: string[]) => {
      if (typeof window === 'undefined') return

      const params = new URLSearchParams(window.location.search)
      keys.forEach((key) => params.delete(key))

      const newURL = `${window.location.pathname}?${params.toString()}`
      window.history.replaceState({}, '', newURL)

      onStateChange?.(parseURLState())
    },
    [onStateChange],
  )

  /**
   * Select a task (update issue in URL)
   * Note: URL uses 'issue' param, but we use issueNumber internally
   */
  const selectIssue = useCallback(
    (issueNumber: number | null) => {
      if (issueNumber) {
        // URL param is 'issue' but type uses issueNumber
        pushURL({ issueNumber } as unknown as Partial<DashboardURLState>)
      } else {
        clearURLParams(['issue', 'tab'])
      }
    },
    [pushURL, clearURLParams],
  )

  /**
   * Change view mode
   */
  const changeView = useCallback(
    (view: ViewMode) => {
      updateURL({ view })
    },
    [updateURL],
  )

  /**
   * Update filters
   */
  const updateFilters = useCallback(
    (filters: {
      date?: string
      label?: string
      status?: string
      q?: string
      sort?: string
      dir?: 'asc' | 'desc'
    }) => {
      updateURL(filters)
    },
    [updateURL],
  )

  /**
   * Set tab (for task detail)
   */
  const setTab = useCallback(
    (tab: string | null) => {
      if (tab) {
        updateURL({ tab })
      } else {
        clearURLParams(['tab'])
      }
    },
    [updateURL, clearURLParams],
  )

  // Set up popstate listener for browser back/forward
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePopstate = () => {
      onStateChange?.(parseURLState())
    }

    window.addEventListener('popstate', handlePopstate)
    return () => window.removeEventListener('popstate', handlePopstate)
  }, [onStateChange])

  return {
    // State
    urlState: parseURLState(),
    // Actions
    updateURL,
    pushURL,
    clearURLParams,
    selectIssue,
    changeView,
    updateFilters,
    setTab,
  }
}
