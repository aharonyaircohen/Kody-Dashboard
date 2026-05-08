/**
 * @fileType component
 * @domain kody
 * @pattern kody-status-banner
 * @ai-summary Banner showing Kody's current state: idle, working, failed, or gate-waiting
 */
'use client'

import { useState, useEffect, type ReactNode } from 'react'
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
  /** Extra controls rendered on the right side of the banner (e.g. expand/collapse all). */
  trailing?: ReactNode
}

type KodyState =
  | { status: 'idle'; taskCount: number }
  | {
      status: 'working'
      workingCount: number
      /** PRs with `ciStatus === 'failure'`. Active retry, not yet column=failed. */
      ciFailing: number
      /** PRs with `ciStatus === 'running' | 'pending'`. */
      ciRunning: number
      /** PRs with `ciStatus === 'success'` (and not merged). Ready to land. */
      ciReady: number
      /** Tasks in flight without a PR yet (taskify/architect/build before PR opens). */
      noPrYet: number
      /**
       * First task whose CI is failing — linked from the banner as a one-click
       * jump. When multiple PRs are red, only the first is linked; the count
       * conveys the rest.
       */
      firstFailingTask?: KodyTask
    }
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

  const working = tasks.filter(
    (t) => t.column === 'building' || t.column === 'retrying',
  )
  if (working.length > 0) {
    // Roll up CI status across in-flight PRs. We surface this on the banner
    // because the bare "working on N tasks" count is already visible in the
    // kanban column header — operators want to know whether a stuck task is
    // *actually* stuck (CI red, retry exhausted) vs. just running.
    let ciFailing = 0
    let ciRunning = 0
    let ciReady = 0
    let noPrYet = 0
    let firstFailingTask: KodyTask | undefined
    for (const t of working) {
      const ci = t.associatedPR?.ciStatus
      if (!t.associatedPR) {
        noPrYet++
        continue
      }
      if (ci === 'failure') {
        ciFailing++
        if (!firstFailingTask) firstFailingTask = t
      } else if (ci === 'running' || ci === 'pending') {
        ciRunning++
      } else if (ci === 'success') {
        ciReady++
      }
    }
    return {
      status: 'working',
      workingCount: working.length,
      ciFailing,
      ciRunning,
      ciReady,
      noPrYet,
      firstFailingTask,
    }
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
  trailing,
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
        {trailing}
      </div>
    )
  }

  if (state.status === 'working') {
    // Color the banner red when any in-flight PR has failing CI — that's the
    // signal the operator can act on. Stays blue when everything is healthy.
    const hasFail = state.ciFailing > 0
    const containerClass = hasFail
      ? 'flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] bg-red-500/[0.06]'
      : 'flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] bg-blue-500/[0.06]'
    const dotClass = hasFail ? 'bg-red-500' : 'bg-blue-500'
    const pingClass = hasFail ? 'bg-red-400' : 'bg-blue-400'
    const ciPills: ReactNode[] = []
    if (state.ciReady > 0) {
      ciPills.push(
        <Badge
          key="ready"
          variant="outline"
          className="text-emerald-400 border-emerald-500/30"
          title={`${state.ciReady} PR(s) with green CI, ready to merge`}
        >
          {state.ciReady} ready
        </Badge>,
      )
    }
    if (state.ciRunning > 0) {
      ciPills.push(
        <Badge
          key="running"
          variant="outline"
          className="text-blue-400 border-blue-500/30"
          title={`${state.ciRunning} PR(s) with CI in progress`}
        >
          {state.ciRunning} CI running
        </Badge>,
      )
    }
    if (state.ciFailing > 0) {
      const failNode =
        state.firstFailingTask && state.ciFailing === 1 ? (
          <a
            key="failing"
            href={
              state.firstFailingTask.associatedPR?.html_url ??
              getGitHubIssueUrl(state.firstFailingTask.issueNumber)
            }
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={`CI failing on PR for #${state.firstFailingTask.issueNumber} — ${state.firstFailingTask.title}`}
            className="no-underline"
          >
            <Badge
              variant="outline"
              className="text-red-400 border-red-500/40 hover:border-red-500/70"
            >
              1 CI failing
            </Badge>
          </a>
        ) : (
          <Badge
            key="failing"
            variant="outline"
            className="text-red-400 border-red-500/40"
            title={`${state.ciFailing} PR(s) with failing CI`}
          >
            {state.ciFailing} CI failing
          </Badge>
        )
      ciPills.push(failNode)
    }
    if (state.noPrYet > 0) {
      ciPills.push(
        <Badge
          key="no-pr"
          variant="outline"
          className="text-muted-foreground border-muted-foreground/30"
          title={`${state.noPrYet} task(s) in flight before a PR has opened (taskify / architect / pre-PR build)`}
        >
          {state.noPrYet} pre-PR
        </Badge>,
      )
    }
    const summary =
      state.workingCount === 1 ? '1 task in flight' : `${state.workingCount} tasks in flight`
    return (
      <div className={containerClass}>
        <span className="relative flex h-2.5 w-2.5">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pingClass}`}
          />
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dotClass}`} />
        </span>
        <span className="text-sm text-muted-foreground">
          Kody · <span className="text-foreground font-medium">{summary}</span>
        </span>
        {ciPills.length > 0 ? <div className="flex items-center gap-1.5">{ciPills}</div> : null}
        <RefreshIndicator isFetching={isFetching} dataUpdatedAt={dataUpdatedAt} />
        {trailing}
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
        {trailing}
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
      {trailing}
    </div>
  )
}
