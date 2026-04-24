/**
 * @fileType component
 * @domain kody
 * @pattern kody-status-banner
 * @ai-summary Banner showing Kody's current state: idle, working, failed, or gate-waiting
 */
'use client'

import { useState, useEffect } from 'react'
import { formatRelativeTime } from '../utils'
import { formatElapsed } from '../pipeline-utils'
import type { KodyTask } from '../types'
import { getGitHubIssueUrl } from '../constants'
import { Loader2 } from 'lucide-react'
import { Badge } from '@dashboard/ui/badge'

interface KodyStatusBannerProps {
  tasks: KodyTask[]
  /** Whether a background refetch is in progress */
  isFetching?: boolean
  /** Timestamp (ms) of last successful data update */
  dataUpdatedAt?: number
}

type KodyState =
  | { status: 'idle'; taskCount: number }
  | { status: 'working'; workingCount: number }
  | { status: 'failed'; task: KodyTask; failedAgo: string }
  | { status: 'gate-waiting'; task: KodyTask }

/** Client-only relative time — avoids hydration mismatch from new Date() during SSR */
function RelativeTime({ date }: { date: string }) {
  const [text, setText] = useState<string>('')
  useEffect(() => {
    setText(formatRelativeTime(date))
    const interval = setInterval(() => setText(formatRelativeTime(date)), 60_000)
    return () => clearInterval(interval)
  }, [date])
  return <>{text}</>
}

function deriveKodyState(tasks: KodyTask[]): KodyState {
  // Priority: working > gate-waiting > failed > idle

  const workingCount = tasks.filter(
    (t) => t.column === 'building' || t.column === 'retrying',
  ).length
  if (workingCount > 0) {
    return { status: 'working', workingCount }
  }

  const gateWaiting = tasks.find((t) => t.column === 'gate-waiting')
  if (gateWaiting) {
    return { status: 'gate-waiting', task: gateWaiting }
  }

  const failed = tasks.find((t) => t.column === 'failed')
  if (failed) {
    return { status: 'failed', task: failed, failedAgo: formatRelativeTime(failed.updatedAt) }
  }

  return { status: 'idle', taskCount: tasks.length }
}

/** Subtle refresh indicator — shows spinner when fetching, "Updated Xs ago" otherwise */
function RefreshIndicator({
  isFetching,
  dataUpdatedAt,
}: {
  isFetching?: boolean
  dataUpdatedAt?: number
}) {
  const [, setTick] = useState(0)

  // Tick every 15s to keep "Updated X ago" fresh
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 15_000)
    return () => clearInterval(interval)
  }, [])

  if (!dataUpdatedAt) return null

  const ago = formatElapsed(new Date(dataUpdatedAt))

  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 ml-auto shrink-0">
      {isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
      <span className="hidden sm:inline">{ago} ago</span>
    </span>
  )
}

export function KodyStatusBanner({
  tasks,
  isFetching,
  dataUpdatedAt,
}: KodyStatusBannerProps) {
  const state = deriveKodyState(tasks)

  if (state.status === 'idle') {
    return (
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] bg-white/[0.02]">
        <span className="relative flex h-2.5 w-2.5">
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        <span className="text-sm text-muted-foreground">
          Kody is <span className="text-foreground font-medium">idle</span> — {state.taskCount} open
          issues in backlog
        </span>
        <RefreshIndicator isFetching={isFetching} dataUpdatedAt={dataUpdatedAt} />
      </div>
    )
  }

  if (state.status === 'working') {
    const label =
      state.workingCount === 1
        ? 'working on 1 task'
        : `working on ${state.workingCount} tasks`
    return (
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] bg-blue-500/[0.06]">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
        </span>
        <span className="text-sm text-muted-foreground">
          Kody is <span className="text-foreground font-medium">{label}</span>
        </span>
        <RefreshIndicator isFetching={isFetching} dataUpdatedAt={dataUpdatedAt} />
      </div>
    )
  }

  if (state.status === 'gate-waiting') {
    return (
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] bg-amber-500/[0.06]">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500" />
        </span>
        <span className="text-sm">
          <span className="text-yellow-400 font-medium">Approval needed</span> on{' '}
          <a
            href={getGitHubIssueUrl(state.task.issueNumber)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-yellow-400 hover:underline font-mono"
            title={`View issue #${state.task.issueNumber} on GitHub`}
          >
            #{state.task.issueNumber}
          </a>{' '}
          <span className="text-muted-foreground">— {state.task.title}</span>
        </span>
        <RefreshIndicator isFetching={isFetching} dataUpdatedAt={dataUpdatedAt} />
        <Badge
          variant="outline"
          className="text-yellow-400 border-yellow-500/30"
          title="This task is waiting for approval before continuing"
        >
          Gate
        </Badge>
      </div>
    )
  }

  // failed
  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] bg-red-500/[0.06]">
      <span className="relative flex h-2.5 w-2.5">
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
      </span>
      <span className="text-sm">
        <span className="text-red-400 font-medium">Failed</span> on{' '}
        <a
          href={getGitHubIssueUrl(state.task.issueNumber)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-red-400 hover:underline font-mono"
          title={`View issue #${state.task.issueNumber} on GitHub`}
        >
          #{state.task.issueNumber}
        </a>{' '}
        <span className="text-muted-foreground">— {state.task.title}</span>
      </span>
      <RefreshIndicator isFetching={isFetching} dataUpdatedAt={dataUpdatedAt} />
      <span className="text-xs text-muted-foreground" title="Failed at">
        <RelativeTime date={state.task.updatedAt} />
      </span>
    </div>
  )
}
