/**
 * @fileType component
 * @domain kody
 * @pattern filter-bar
 * @ai-summary Dedicated filter sub-header bar for Kody dashboard with view toggle and consolidated filter dropdown
 */
'use client'

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { cn } from '../utils'
import { Search } from 'lucide-react'
import type { SortField, SortDirection } from '../types'
import { FilterDropdown } from './FilterDropdown'

export type ViewMode = 'running' | 'backlog' | 'queue'

export interface FilterBarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  dateFilter: string
  onDateFilterChange: (value: string) => void
  statusFilter: string
  onStatusFilterChange: (value: string) => void
  labelFilter: string
  onLabelFilterChange: (value: string) => void
  availableLabels: string[]
  labelCounts: Record<string, number>
  priorityFilter: string
  onPriorityFilterChange: (value: string) => void
  statusCounts: Record<string, number>
  totalCount: number
  filteredCount: number
  runningCount: number
  backlogCount: number
  queueCount?: number
  searchQuery?: string
  onSearchChange?: (value: string) => void
  sortField?: SortField
  onSortFieldChange?: (field: SortField) => void
  sortDirection?: SortDirection
  onSortDirectionChange?: (direction: SortDirection) => void
}

export interface FilterBarHandle {
  focusSearch: () => void
}

export { DATE_FILTERS, STATUS_FILTERS } from './FilterDropdown'

/** Pill-style toggle between Running, Backlog, and Queue views */
export function ViewToggle({
  viewMode,
  onViewModeChange,
  runningCount,
  backlogCount,
  queueCount,
}: {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  runningCount: number
  backlogCount: number
  queueCount?: number
}) {
  return (
    <div className="inline-flex items-center rounded-md bg-white/[0.04] p-0.5 gap-0.5">
      <button
        type="button"
        onClick={() => onViewModeChange('running')}
        className={cn(
          'px-3 py-1 rounded text-xs font-medium transition-colors',
          viewMode === 'running'
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]',
        )}
      >
        Running ({runningCount})
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('backlog')}
        className={cn(
          'px-3 py-1 rounded text-xs font-medium transition-colors',
          viewMode === 'backlog'
            ? 'bg-zinc-600 text-white shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]',
        )}
      >
        Backlog ({backlogCount})
      </button>
      {queueCount !== undefined && (
        <button
          type="button"
          onClick={() => onViewModeChange('queue')}
          className={cn(
            'px-3 py-1 rounded text-xs font-medium transition-colors',
            viewMode === 'queue'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]',
          )}
        >
          Queue ({queueCount})
        </button>
      )}
    </div>
  )
}

export const FilterBar = forwardRef<FilterBarHandle, FilterBarProps>(function FilterBar(
  {
    viewMode,
    onViewModeChange,
    dateFilter,
    onDateFilterChange,
    statusFilter,
    onStatusFilterChange,
    labelFilter,
    onLabelFilterChange,
    availableLabels,
    labelCounts,
    priorityFilter,
    onPriorityFilterChange,
    statusCounts,
    totalCount,
    filteredCount,
    runningCount,
    backlogCount,
    queueCount,
    searchQuery = '',
    onSearchChange,
    sortField = 'updatedAt',
    onSortFieldChange,
    sortDirection = 'desc',
    onSortDirectionChange,
  },
  ref,
) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      searchInputRef.current?.focus()
    },
  }))

  return (
    <div className="flex items-center gap-3 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-white/[0.02]">
      {/* View toggle — Running / Backlog */}
      <ViewToggle
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        runningCount={runningCount}
        backlogCount={backlogCount}
        queueCount={queueCount}
      />

      {/* Search input */}
      {onSearchChange && (
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="h-8 pl-8 pr-3 text-xs rounded-md bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-white/20 w-40"
          />
        </div>
      )}

      {/* Consolidated filter dropdown */}
      <FilterDropdown
        dateFilter={dateFilter}
        onDateFilterChange={onDateFilterChange}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        labelFilter={labelFilter}
        onLabelFilterChange={onLabelFilterChange}
        availableLabels={availableLabels}
        labelCounts={labelCounts}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={onPriorityFilterChange}
        statusCounts={statusCounts}
        totalCount={totalCount}
        sortField={sortField}
        onSortFieldChange={onSortFieldChange}
        sortDirection={sortDirection}
        onSortDirectionChange={onSortDirectionChange}
      />

      {/* Task count indicator */}
      <span className="text-xs text-muted-foreground ml-auto">
        {filteredCount} of {totalCount} tasks
      </span>
    </div>
  )
})
