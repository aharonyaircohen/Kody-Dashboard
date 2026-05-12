/**
 * @fileType component
 * @domain kody
 * @pattern vibe
 * @ai-summary Compact selectable list of open tasks for the Vibe page.
 *   Lighter than TaskList — no actions, no DnD, no inline editing. Tasks are
 *   sorted by updatedAt desc; selecting a row bubbles the issueNumber up so
 *   the parent can swap chat scope + preview iframe.
 */
'use client'

import { useMemo, useState } from 'react'
import type { KodyTask } from '../types'
import { cn, formatRelativeTime } from '../utils'
import { CIStatusBadge } from './CIStatusBadge'
import { GitPullRequest, Inbox, Loader2, Search, X } from 'lucide-react'

interface VibeIssueListProps {
  tasks: KodyTask[] | undefined
  selectedIssueNumber: number | null
  onSelect: (task: KodyTask | null) => void
  isLoading: boolean
}

export function VibeIssueList({
  tasks,
  selectedIssueNumber,
  onSelect,
  isLoading,
}: VibeIssueListProps) {
  const [query, setQuery] = useState('')

  // Only open issues — once merged/closed the row vanishes by design.
  // Sort by updatedAt desc so the freshest work surfaces.
  const openTasks = useMemo(() => {
    if (!tasks) return []
    return [...tasks]
      .filter((t) => t.state === 'open')
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
  }, [tasks])

  // Match title (case-insensitive substring) or issue number (with or
  // without leading '#'). Empty query falls through unchanged.
  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return openTasks
    const numericQ = q.replace(/^#/, '')
    return openTasks.filter((t) => {
      const titleMatch = t.title.toLowerCase().includes(q)
      const numberMatch = String(t.issueNumber).includes(numericQ)
      return titleMatch || numberMatch
    })
  }, [openTasks, query])

  const searchActive = query.trim().length > 0

  const renderSearchBar = (
    <div className="px-3 py-2 border-b border-white/[0.06] bg-black/20 sticky top-0 z-10">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or #number"
          aria-label="Search open issues"
          className="w-full bg-zinc-900/60 border border-zinc-800 rounded-md pl-7 pr-7 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
        />
        {searchActive && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )

  if (isLoading && openTasks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {renderSearchBar}
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      </div>
    )
  }

  if (openTasks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {renderSearchBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-4 text-center">
          <Inbox className="w-6 h-6 text-zinc-600" />
          <p className="text-xs text-zinc-500">No open issues</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {renderSearchBar}
      <ul className="flex flex-col">
        {!searchActive && (
          <li className="px-3 py-2 border-b border-white/[0.06]">
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={cn(
                'w-full text-left text-xs font-medium px-2 py-1.5 rounded transition-colors',
                selectedIssueNumber === null
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
              )}
            >
              Default preview
            </button>
          </li>
        )}
        {searchActive && filteredTasks.length === 0 && (
          <li className="px-4 py-6 text-center">
            <p className="text-xs text-zinc-500">
              No matches for{' '}
              <span className="text-zinc-300">&ldquo;{query}&rdquo;</span>
            </p>
          </li>
        )}
        {filteredTasks.map((task) => {
        const isSelected = task.issueNumber === selectedIssueNumber
        const hasPR = !!task.associatedPR
        return (
          <li key={task.id} className="border-b border-white/[0.04]">
            <button
              type="button"
              onClick={() => onSelect(task)}
              className={cn(
                'w-full text-left px-3 py-2.5 transition-colors',
                isSelected
                  ? 'bg-emerald-500/10 border-l-2 border-l-emerald-500'
                  : 'border-l-2 border-l-transparent hover:bg-zinc-800/40',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'text-xs tabular-nums shrink-0',
                    isSelected ? 'text-emerald-300' : 'text-zinc-500',
                  )}
                >
                  #{task.issueNumber}
                </span>
                <span
                  className={cn(
                    'text-sm truncate flex-1',
                    isSelected ? 'text-white' : 'text-zinc-300',
                  )}
                  title={task.title}
                >
                  {task.title}
                </span>
                {hasPR && (
                  <GitPullRequest className="w-3 h-3 text-purple-400 shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 pl-7">
                {task.associatedPR && (
                  <CIStatusBadge prNumber={task.associatedPR.number} />
                )}
                <span className="text-[10px] text-zinc-600">
                  {formatRelativeTime(task.updatedAt)}
                </span>
              </div>
            </button>
          </li>
        )
      })}
      </ul>
    </div>
  )
}
