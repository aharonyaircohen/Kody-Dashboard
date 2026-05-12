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

import { useMemo } from 'react'
import type { KodyTask } from '../types'
import { cn, formatRelativeTime } from '../utils'
import { CIStatusBadge } from './CIStatusBadge'
import { GitPullRequest, Inbox, Loader2 } from 'lucide-react'

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

  if (isLoading && openTasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
      </div>
    )
  }

  if (openTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
        <Inbox className="w-6 h-6 text-zinc-600" />
        <p className="text-xs text-zinc-500">No open issues</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col">
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
      {openTasks.map((task) => {
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
  )
}
