/**
 * @fileType component
 * @domain kody
 * @pattern queue-view
 * @ai-summary Queue-specific task list showing queued, active, and failed queue tasks
 */
'use client'

import { cn } from '../utils'
import { MiniPipelineProgress } from './MiniPipelineProgress'
import type { KodyTask } from '../types'
import { Button } from '@dashboard/ui/button'
import { Loader2, ListMinus, RotateCcw, Inbox, CheckCircle2, XCircle, Clock } from 'lucide-react'

interface QueueViewProps {
  tasks: KodyTask[]
  onTaskSelect?: (task: KodyTask) => void
  onRemoveFromQueue?: (issueNumber: number) => void
  onRetry?: (taskId: string) => void
  selectedTask?: KodyTask | null
}

type QueueStatus = 'active' | 'waiting' | 'failed'

function getQueueStatus(task: KodyTask): QueueStatus {
  if (task.labels.includes('kody:queue-active')) return 'active'
  if (task.labels.includes('kody:queue-failed')) return 'failed'
  return 'waiting'
}

const statusConfig: Record<
  QueueStatus,
  { label: string; bg: string; text: string; icon: React.ElementType }
> = {
  active: {
    label: 'Active',
    bg: 'bg-green-500/15',
    text: 'text-green-400',
    icon: Loader2,
  },
  waiting: {
    label: 'Waiting',
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    icon: Clock,
  },
  failed: {
    label: 'Failed',
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    icon: XCircle,
  },
}

export function QueueView({
  tasks,
  onTaskSelect,
  onRemoveFromQueue,
  onRetry,
  selectedTask,
}: QueueViewProps) {
  // Sort: active first, then waiting (FIFO), then failed
  const sortedTasks = [...tasks].sort((a, b) => {
    const statusOrder: Record<QueueStatus, number> = { active: 0, waiting: 1, failed: 2 }
    const aStatus = getQueueStatus(a)
    const bStatus = getQueueStatus(b)
    if (statusOrder[aStatus] !== statusOrder[bStatus]) {
      return statusOrder[aStatus] - statusOrder[bStatus]
    }
    return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
  })

  // Summary counts
  const activeCount = tasks.filter((t) => t.labels.includes('kody:queue-active')).length
  const waitingCount = tasks.filter((t) => t.labels.includes('kody:queued')).length
  const failedCount = tasks.filter((t) => t.labels.includes('kody:queue-failed')).length

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-4 py-16">
        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] flex items-center justify-center">
          <Inbox className="w-6 h-6 text-muted-foreground/30" />
        </div>
        <p className="text-sm text-muted-foreground/50 text-center">
          No tasks in queue.
          <br />
          Add tasks from the backlog using the &quot;Add to Queue&quot; action.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] text-xs">
        <span className="text-muted-foreground">
          <span className="font-semibold text-foreground">{waitingCount}</span> queued
        </span>
        <span className="text-white/20">·</span>
        <span className="text-muted-foreground">
          <span className="font-semibold text-green-400">{activeCount}</span> active
        </span>
        <span className="text-white/20">·</span>
        <span className="text-muted-foreground">
          <span className="font-semibold text-red-400">{failedCount}</span> failed
        </span>
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto">
        {sortedTasks.map((task, index) => {
          const status = getQueueStatus(task)
          const config = statusConfig[status]
          const StatusIcon = config.icon
          const isSelected = selectedTask?.id === task.id

          // Position number for waiting tasks
          const position =
            status === 'waiting'
              ? sortedTasks.filter((t, i) => i < index && getQueueStatus(t) === 'waiting').length +
                1
              : null

          return (
            <div
              key={task.id}
              onClick={() => onTaskSelect?.(task)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] cursor-pointer transition-colors',
                'hover:bg-white/[0.03]',
                isSelected && 'bg-blue-500/[0.08] border-l-2 border-l-blue-500',
              )}
            >
              {/* Position / Status indicator */}
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold',
                  config.bg,
                  config.text,
                )}
              >
                {status === 'active' ? (
                  <StatusIcon className="w-4 h-4 animate-spin" />
                ) : position ? (
                  position
                ) : (
                  <StatusIcon className="w-4 h-4" />
                )}
              </div>

              {/* Task info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{task.title}</span>
                  <span className="text-xs text-muted-foreground/50 shrink-0">
                    #{task.issueNumber}
                  </span>
                </div>

                {/* Status badge + pipeline progress for active */}
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider',
                      config.bg,
                      config.text,
                    )}
                  >
                    {config.label}
                  </span>

                  {status === 'active' && task.pipeline && (
                    <div className="flex-1 min-w-0">
                      <MiniPipelineProgress task={task} variant="inline" />
                    </div>
                  )}

                  {status === 'failed' && (
                    <span className="text-[10px] text-red-400/70">Needs manual review</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {status === 'waiting' && onRemoveFromQueue && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveFromQueue(task.issueNumber)
                    }}
                    title="Remove from queue"
                  >
                    <ListMinus className="w-3.5 h-3.5" />
                  </Button>
                )}
                {status === 'failed' && onRetry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-orange-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRetry(task.id)
                    }}
                    title="Retry task"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                )}
                {status === 'active' && <CheckCircle2 className="w-4 h-4 text-green-500/50" />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
