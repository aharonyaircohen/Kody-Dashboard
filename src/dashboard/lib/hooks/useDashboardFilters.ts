/**
 * @fileType hook
 * @domain kody
 * @pattern state-management
 * @ai-summary Custom hook encapsulating dashboard filter state and URL synchronization
 */
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ViewMode } from '../components/FilterBar'

interface UseDashboardFiltersOptions {
  /** Initial view mode from page props */
  initialViewMode?: ViewMode
}

interface UseDashboardFiltersReturn {
  // Filter state
  dateFilter: string
  setDateFilter: (value: string) => void
  labelFilter: string
  setLabelFilter: (value: string) => void
  statusFilter: string
  setStatusFilter: (value: string) => void
  viewMode: ViewMode
  setViewMode: (value: ViewMode) => void
  searchQuery: string
  setSearchQuery: (value: string) => void
  debouncedSearch: string
  sortField: string
  setSortField: (value: string) => void
  sortDirection: 'asc' | 'desc'
  setSortDirection: (value: 'asc' | 'desc') => void
  // Computed
  days: number | undefined
}

/**
 * Get initial filter value from URL or default
 */
function getInitialFilter(
  paramName: string,
  defaultValue: string,
  validator?: (value: string) => string,
): string {
  if (typeof window === 'undefined') return defaultValue
  const urlValue = new URLSearchParams(window.location.search).get(paramName)
  const validated = validator ? validator(urlValue ?? defaultValue) : (urlValue ?? defaultValue)
  return validated
}

/**
 * Hook that encapsulates dashboard filter state with URL synchronization
 * This extracts ~40 lines of filter state management from KodyDashboard
 */
export function useDashboardFilters(
  options: UseDashboardFiltersOptions = {},
): UseDashboardFiltersReturn {
  const { initialViewMode = 'running' } = options

  const [dateFilter, setDateFilter] = useState<string>(() => getInitialFilter('date', '30d'))
  const [labelFilter, setLabelFilter] = useState<string>(() => getInitialFilter('label', 'all'))
  const [statusFilter, setStatusFilter] = useState<string>(() => getInitialFilter('status', 'all'))
  const [viewMode, setViewMode] = useState<ViewMode>(
    () =>
      getInitialFilter('view', initialViewMode, (v) =>
        ['backlog', 'queue'].includes(v) ? v : initialViewMode,
      ) as ViewMode,
  )
  const [searchQuery, setSearchQuery] = useState<string>(() => getInitialFilter('q', ''))
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery)
  const [sortField, setSortField] = useState<string>(() => getInitialFilter('sort', 'updatedAt'))
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
    () => getInitialFilter('dir', 'desc', (v) => (v === 'asc' ? 'asc' : 'desc')) as 'asc' | 'desc',
  )

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])

  // Set search from outside (e.g., keyboard shortcuts) - reserved for future use
  const _setSearchQuery = useCallback((value: string) => {
    setSearchQuery(value)
    setDebouncedSearch(value)
  }, [])

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [])

  // Compute days from date filter
  const DATE_FILTERS = [
    { value: '7d', days: 7 },
    { value: '30d', days: 30 },
    { value: '90d', days: 90 },
    { value: 'all', days: undefined },
  ]
  const filter = DATE_FILTERS.find((f) => f.value === dateFilter)
  const days = filter?.days

  return {
    // Filter state
    dateFilter,
    setDateFilter,
    labelFilter,
    setLabelFilter,
    statusFilter,
    setStatusFilter,
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery: handleSearchChange,
    debouncedSearch,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    // Computed
    days,
  }
}
