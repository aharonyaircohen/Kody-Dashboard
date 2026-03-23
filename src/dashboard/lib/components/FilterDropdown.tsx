/**
 * @fileType component
 * @domain kody
 * @pattern filter-dropdown
 * @ai-summary Consolidated dropdown for all task filters — status, label, priority, date, and sort
 */
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dashboard/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/ui/select'
import { cn } from '../utils'
import { PRIORITY_LEVELS, PRIORITY_META } from '../constants'
import { Filter, ArrowUp, ArrowDown } from 'lucide-react'
import type { SortField, SortDirection } from '../types'

export const DATE_FILTERS = [
  { label: 'All time', value: 'all', days: undefined },
  { label: 'Last 7 days', value: '7d', days: 7 },
  { label: 'Last 30 days', value: '30d', days: 30 },
  { label: 'Last 90 days', value: '90d', days: 90 },
] as const

export const STATUS_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Backlog', value: 'open' },
  { label: 'Building', value: 'building' },
  { label: 'In Review', value: 'review' },
  { label: 'Failed', value: 'failed' },
  { label: 'Needs Approval', value: 'gate-waiting' },
  { label: 'Retrying', value: 'retrying' },
  { label: 'Done', value: 'done' },
] as const

const SORT_OPTIONS = [
  { label: 'Updated', value: 'updatedAt' },
  { label: 'Created', value: 'createdAt' },
  { label: 'Issue #', value: 'issueNumber' },
  { label: 'Status', value: 'column' },
  { label: 'Risk', value: 'riskLevel' },
  { label: 'Progress', value: 'pipelineProgress' },
  { label: 'Assignee', value: 'assignee' },
  { label: 'Title', value: 'title' },
  { label: 'Label', value: 'label' },
  { label: 'Priority', value: 'priority' },
] as const

interface FilterDropdownProps {
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
  sortField?: SortField
  onSortFieldChange?: (field: SortField) => void
  sortDirection?: SortDirection
  onSortDirectionChange?: (direction: SortDirection) => void
}

export function FilterDropdown({
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
  sortField = 'updatedAt',
  onSortFieldChange,
  sortDirection = 'desc',
  onSortDirectionChange,
}: FilterDropdownProps) {
  // Count active filters (excluding 'all' defaults)
  const activeCount = [
    statusFilter !== 'all',
    labelFilter !== 'all',
    priorityFilter !== 'all',
    dateFilter !== 'all',
    sortField !== 'updatedAt' || sortDirection !== 'desc',
  ].filter(Boolean).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors',
            'bg-white/[0.04] border border-white/[0.08] text-muted-foreground',
            'hover:bg-white/[0.06] hover:text-foreground',
            activeCount > 0 && 'bg-blue-500/10 border-blue-500/30 text-blue-400',
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] font-bold">
              {activeCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-96 overflow-y-auto">
        {/* Status */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Status</DropdownMenuLabel>
        {STATUS_FILTERS.map((f) => (
          <DropdownMenuItem
            key={f.value}
            onClick={() => onStatusFilterChange(f.value)}
            className={cn(
              'flex items-center justify-between cursor-pointer',
              statusFilter === f.value && 'bg-accent text-accent-foreground',
            )}
          >
            <span>{f.label}</span>
            <span className="text-xs text-muted-foreground">
              {f.value === 'all' ? totalCount : statusCounts[f.value] || 0}
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {/* Date */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Date</DropdownMenuLabel>
        {DATE_FILTERS.map((f) => (
          <DropdownMenuItem
            key={f.value}
            onClick={() => onDateFilterChange(f.value)}
            className={cn(
              'cursor-pointer',
              dateFilter === f.value && 'bg-accent text-accent-foreground',
            )}
          >
            {f.label}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {/* Priority */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Priority</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onPriorityFilterChange('all')}
          className={cn(
            'cursor-pointer',
            priorityFilter === 'all' && 'bg-accent text-accent-foreground',
          )}
        >
          All priorities
        </DropdownMenuItem>
        {PRIORITY_LEVELS.map((level) => (
          <DropdownMenuItem
            key={level}
            onClick={() => onPriorityFilterChange(level)}
            className={cn(
              'flex items-center gap-2 cursor-pointer',
              priorityFilter === level && 'bg-accent text-accent-foreground',
            )}
          >
            {PRIORITY_META[level].badge}
            <span className="flex-1">{level}</span>
            <span className="text-xs text-muted-foreground">{PRIORITY_META[level].label}</span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {/* Labels */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Label</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onLabelFilterChange('all')}
          className={cn(
            'cursor-pointer',
            labelFilter === 'all' && 'bg-accent text-accent-foreground',
          )}
        >
          All labels ({totalCount})
        </DropdownMenuItem>
        {availableLabels.slice(0, 10).map((label) => (
          <DropdownMenuItem
            key={label}
            onClick={() => onLabelFilterChange(label)}
            className={cn(
              'flex items-center justify-between cursor-pointer',
              labelFilter === label && 'bg-accent text-accent-foreground',
            )}
          >
            <span className="truncate">{label}</span>
            <span className="text-xs text-muted-foreground ml-2">{labelCounts[label] || 0}</span>
          </DropdownMenuItem>
        ))}
        {availableLabels.length > 10 && (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            +{availableLabels.length - 10} more labels
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* Sort */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Sort</DropdownMenuLabel>
        <div className="px-2 py-1.5">
          <Select value={sortField} onValueChange={(v) => onSortFieldChange?.(v as SortField)}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => onSortDirectionChange?.(sortDirection === 'asc' ? 'desc' : 'asc')}
            className={cn(
              'w-full h-8 px-3 rounded-md border text-xs font-medium flex items-center justify-center gap-1 transition-colors',
              'border-white/[0.08] bg-white/[0.04] text-muted-foreground',
              'hover:bg-white/[0.06] hover:text-foreground',
            )}
          >
            {sortDirection === 'asc' ? (
              <>
                <ArrowUp className="w-3.5 h-3.5" />
                Ascending
              </>
            ) : (
              <>
                <ArrowDown className="w-3.5 h-3.5" />
                Descending
              </>
            )}
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
