/**
 * @fileType component
 * @domain kody
 * @pattern task-list
 * @ai-summary Three-zone task list: color bar | title + inline metadata + assignees | actions. Pipeline progress gets its own row only when active.
 */
'use client'

import { useCallback } from 'react'
import { cn, formatRelativeTime } from '../utils'
import { getGitHubIssueUrl, parsePriorityLabel, PRIORITY_META } from '../constants'
import { MiniPipelineProgress } from './MiniPipelineProgress'
import { AnimatedStatusBar } from './v2/AnimatedStatusBar'
import { SimpleTooltip } from './SimpleTooltip'
import { StatusTooltipContent, SubStatusTooltipContent } from './tooltip-content'
import type { KodyTask, ColumnId } from '../types'
import { Button } from '@dashboard/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  GitPullRequest,
  Play,
  Square,
  Bot,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  CircleDot,
  Clock,
  AlertCircle,
  RefreshCw,
  Eye,
  Inbox,
  Pencil,
  Copy,
  ListPlus,
  MoreHorizontal,
} from 'lucide-react'

interface TaskListProps {
  tasks: KodyTask[]
  selectedTask?: KodyTask | null
  executingTaskId?: string | null
  mergingTaskId?: string | null
  focusedIndex?: number
  onTaskSelect?: (task: KodyTask | null) => void
  onExecuteTask?: (taskId: string) => void
  onStopTask?: (task: KodyTask) => void
  onApproveReview?: (task: KodyTask) => Promise<void>
  onTaskHover?: (task: KodyTask) => void
  onAssign?: (issueNumber: number, assignees: string[]) => void
  onUnassign?: (issueNumber: number, assignees: string[]) => void
  collaborators?: { login: string; avatar_url: string }[]
  onOpenPreview?: (task: KodyTask) => void
  onCreateTask?: () => void
  onEditTask?: (task: KodyTask) => void
  onDuplicate?: (task: KodyTask) => void
  onRerun?: (task: KodyTask) => void
  onToggleQueue?: (task: KodyTask) => void
}

// ── Status colors — single source of truth ──
const statusColors: Record<ColumnId, { dot: string; text: string; bg: string; border: string }> = {
  open: { dot: 'bg-zinc-500', text: 'text-zinc-400', bg: '', border: '' },
  building: {
    dot: 'bg-blue-500',
    text: 'text-blue-400',
    bg: 'bg-blue-500/[0.04]',
    border: 'border-l-blue-500/50',
  },
  review: {
    dot: 'bg-purple-500',
    text: 'text-purple-400',
    bg: 'bg-purple-500/[0.04]',
    border: 'border-l-purple-500/50',
  },
  failed: {
    dot: 'bg-red-500',
    text: 'text-red-400',
    bg: 'bg-red-500/[0.05]',
    border: 'border-l-red-500/50',
  },
  'gate-waiting': {
    dot: 'bg-amber-500',
    text: 'text-amber-400',
    bg: 'bg-amber-500/[0.04]',
    border: 'border-l-amber-500/50',
  },
  retrying: {
    dot: 'bg-orange-500',
    text: 'text-orange-400',
    bg: 'bg-orange-500/[0.04]',
    border: 'border-l-orange-500/50',
  },
  done: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/[0.03]',
    border: 'border-l-emerald-500/50',
  },
}

// ── Status icon ──
const statusIcon: Record<ColumnId, React.ReactNode> = {
  open: <CircleDot className="w-[18px] h-[18px] text-zinc-500" />,
  building: <Loader2 className="w-[18px] h-[18px] text-blue-400 animate-spin" />,
  review: <GitPullRequest className="w-[18px] h-[18px] text-purple-400" />,
  failed: <XCircle className="w-[18px] h-[18px] text-red-400" />,
  'gate-waiting': <AlertTriangle className="w-[18px] h-[18px] text-amber-400" />,
  retrying: <RotateCcw className="w-[18px] h-[18px] text-orange-400" />,
  done: <CheckCircle2 className="w-[18px] h-[18px] text-emerald-400" />,
}

// ── Status label text ──
const statusLabel: Record<ColumnId, string> = {
  open: 'Backlog',
  building: 'Building',
  review: 'In Review',
  failed: 'Failed',
  'gate-waiting': 'Needs Approval',
  retrying: 'Retrying',
  done: 'Done',
}

export function TaskList({
  tasks,
  selectedTask,
  executingTaskId,
  mergingTaskId: _mergingTaskId,
  onTaskSelect,
  onExecuteTask,
  onStopTask,
  onApproveReview: _onApproveReview,
  onTaskHover,
  onAssign,
  onUnassign: _onUnassign,
  focusedIndex,
  onOpenPreview,
  onCreateTask,
  onEditTask,
  onDuplicate,
  onRerun,
  onToggleQueue,
  collaborators = [],
}: TaskListProps) {
  const handleTaskClick = useCallback(
    (task: KodyTask) => {
      if (onTaskSelect) {
        onTaskSelect(selectedTask?.id === task.id ? null : task)
      }
    },
    [onTaskSelect, selectedTask],
  )

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] flex items-center justify-center">
          <Inbox className="w-6 h-6 text-muted-foreground/40" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No tasks found</p>
          <p className="text-xs text-muted-foreground">
            Tasks you create or that are assigned to Kody will appear here.
          </p>
        </div>
        {onCreateTask && (
          <Button size="sm" onClick={onCreateTask}>
            + New Task
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="divide-y divide-white/[0.06]" role="listbox" aria-label="Tasks">
      {tasks.map((task, index) => {
        const isSelected = task.id === selectedTask?.id
        const isFocused = index === focusedIndex
        const canExecute = task.state === 'open' && onExecuteTask
        const isExecuting = executingTaskId === task.id
        const hasPR = !!task.associatedPR
        const isHardStop = task.column === 'gate-waiting' && task.gateType === 'hard-stop'
        // gate-waiting tasks also show pipeline progress (they're paused mid-pipeline)
        const isActive =
          task.column === 'building' || task.column === 'retrying' || task.column === 'gate-waiting'
        const colors = statusColors[task.column]
        const gateLabel =
          task.column === 'gate-waiting' && task.gateType === 'hard-stop'
            ? 'Hard Stop'
            : task.column === 'gate-waiting' && task.gateType === 'risk-gated'
              ? 'Risk Gated'
              : statusLabel[task.column]

        return (
          <div
            key={task.id}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            onClick={() => handleTaskClick(task)}
            onMouseEnter={() => onTaskHover?.(task)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleTaskClick(task)
              }
            }}
            className={cn(
              'group relative cursor-pointer transition-colors duration-100 border-l-2 border-l-transparent',
              'hover:bg-white/[0.04]',
              colors.bg,
              isSelected && cn('bg-white/[0.06] border-l-2', colors.border),
              isFocused && 'ring-1 ring-blue-500/40 bg-blue-500/5',
              isHardStop && 'ring-1 ring-red-500/30 ring-inset',
            )}
          >
            {/* Main row */}
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Status icon */}
              <div className="shrink-0">{statusIcon[task.column]}</div>

              {/* Content — title + meta */}
              <div
                className={cn(
                  'flex-1 min-w-0',
                  task.column === 'done' &&
                    !isSelected &&
                    'opacity-50 group-hover:opacity-80 transition-opacity',
                )}
              >
                {/* Title row */}
                <div className="flex items-center gap-2.5">
                  <h3 className="text-[15px] font-medium text-zinc-100 truncate flex-1">
                    {task.title}
                  </h3>

                  {/* Assignee avatars + triggered-by actor */}
                  <div className="hidden sm:flex items-center -space-x-1.5 shrink-0">
                    {task.assignees &&
                      task.assignees.map((assignee) => (
                        <SimpleTooltip
                          key={assignee.login}
                          content={`Assignee: @${assignee.login}`}
                          side="bottom"
                        >
                          <span className="inline-block">
                            <Avatar className="h-5 w-5 ring-2 ring-[#0d1117]">
                              <AvatarImage src={assignee.avatar_url} alt={assignee.login} />
                              <AvatarFallback className="text-[8px] bg-zinc-800 text-zinc-400">
                                {assignee.login[0]?.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          </span>
                        </SimpleTooltip>
                      ))}
                    {task.pipeline?.triggeredByLogin &&
                      !task.assignees?.some((a) => a.login === task.pipeline?.triggeredByLogin) && (
                        <SimpleTooltip
                          content={`Triggered by @${task.pipeline.triggeredByLogin}`}
                          side="bottom"
                        >
                          <span className="inline-block">
                            <Avatar className="h-5 w-5 ring-2 ring-[#0d1117] opacity-60">
                              <AvatarImage
                                src={`https://github.com/${task.pipeline.triggeredByLogin}.png?size=40`}
                                alt={task.pipeline.triggeredByLogin}
                              />
                              <AvatarFallback className="text-[8px] bg-zinc-700 text-zinc-400">
                                {task.pipeline.triggeredByLogin[0]?.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          </span>
                        </SimpleTooltip>
                      )}
                    {task.pipeline?.issueCreator &&
                      task.pipeline.issueCreator !== task.pipeline?.triggeredByLogin && (
                        <SimpleTooltip
                          content={`Issue owner @${task.pipeline.issueCreator}`}
                          side="bottom"
                        >
                          <span className="inline-block">
                            <Avatar className="h-5 w-5 ring-2 ring-[#0d1117] opacity-80">
                              <AvatarImage
                                src={`https://github.com/${task.pipeline.issueCreator}.png?size=40`}
                                alt={task.pipeline.issueCreator}
                              />
                              <AvatarFallback className="text-[8px] bg-blue-900 text-blue-200">
                                {task.pipeline.issueCreator[0]?.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          </span>
                        </SimpleTooltip>
                      )}
                  </div>
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                  <SimpleTooltip content="View issue on GitHub" side="bottom">
                    <a
                      href={getGitHubIssueUrl(task.issueNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={cn('font-mono font-semibold hover:underline', colors.text)}
                    >
                      #{task.issueNumber}
                    </a>
                  </SimpleTooltip>

                  <SimpleTooltip
                    content={<StatusTooltipContent column={task.column} gateType={task.gateType} />}
                    side="bottom"
                  >
                    <span className={cn('font-medium cursor-default', colors.text)}>
                      {gateLabel}
                    </span>
                  </SimpleTooltip>

                  {task.isKodyAssigned && (
                    <SimpleTooltip content="Assigned to Kody AI agent" side="bottom">
                      <span className="inline-flex items-center gap-0.5 font-bold text-blue-400 cursor-default">
                        <Bot className="w-3 h-3" />
                        KODY
                      </span>
                    </SimpleTooltip>
                  )}

                  {/* Priority badge */}
                  {task.labels
                    .filter((l) => l.startsWith('priority:'))
                    .map((label) => {
                      const level = parsePriorityLabel(label)
                      if (!level) return null
                      const meta = PRIORITY_META[level]
                      return (
                        <span
                          key={label}
                          className={cn(
                            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border',
                            meta.colorClass,
                          )}
                        >
                          {level}
                        </span>
                      )
                    })}

                  {/* Active pipeline progress — inline dots + stage label */}
                  {isActive && <MiniPipelineProgress task={task} variant="inline" />}

                  {/* Non-pipeline sub-statuses (only shown when NOT active pipeline) */}
                  {!isActive && task.isTimeout && (
                    <SimpleTooltip
                      content={<SubStatusTooltipContent type="timeout" />}
                      side="bottom"
                    >
                      <span className="inline-flex items-center gap-0.5 font-semibold text-orange-400 cursor-default">
                        <Clock className="w-3 h-3" />
                        Timeout
                      </span>
                    </SimpleTooltip>
                  )}
                  {!isActive && task.isExhausted && (
                    <SimpleTooltip
                      content={<SubStatusTooltipContent type="exhausted" />}
                      side="bottom"
                    >
                      <span className="inline-flex items-center gap-0.5 font-semibold text-red-400 cursor-default">
                        <RefreshCw className="w-3 h-3" />
                        Exhausted
                      </span>
                    </SimpleTooltip>
                  )}
                  {!isActive && task.isSupervisorError && (
                    <SimpleTooltip content={<SubStatusTooltipContent type="error" />} side="bottom">
                      <span className="inline-flex items-center gap-0.5 font-semibold text-red-400 cursor-default">
                        <AlertCircle className="w-3 h-3" />
                        Error
                      </span>
                    </SimpleTooltip>
                  )}
                  {task.clarifyWaiting && (
                    <SimpleTooltip
                      content={<SubStatusTooltipContent type="needs-answer" />}
                      side="bottom"
                    >
                      <span className="hidden sm:inline-flex items-center gap-0.5 font-semibold text-blue-400 cursor-default">
                        <AlertCircle className="w-3 h-3" />
                        Needs Answer
                      </span>
                    </SimpleTooltip>
                  )}

                  <span className="text-zinc-600">{formatRelativeTime(task.updatedAt)}</span>

                  {task.labels.length > 0 && (
                    <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-medium truncate max-w-24">
                      {task.labels[0]}
                    </span>
                  )}

                  {hasPR && (
                    <SimpleTooltip content="Open PR in GitHub" side="bottom">
                      <a
                        href={task.associatedPR!.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors font-medium"
                      >
                        <GitPullRequest className="w-3 h-3" />
                        PR
                      </a>
                    </SimpleTooltip>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="hidden sm:flex items-center gap-1 shrink-0">
                {hasPR && onOpenPreview && (
                  <SimpleTooltip content="Open PR preview" side="bottom">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenPreview(task)
                      }}
                      aria-label="Open PR preview"
                      className="h-7 w-7 p-0 text-emerald-400 hover:bg-emerald-500/20"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </SimpleTooltip>
                )}

                {(task.column === 'building' &&
                  task.workflowRun?.status === 'in_progress' &&
                  onStopTask) ||
                (canExecute && onExecuteTask) ? (
                  <SimpleTooltip
                    content={task.column === 'building' ? 'Stop running task' : 'Run task'}
                    side="bottom"
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isExecuting}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (task.column === 'building') onStopTask?.(task)
                        else if (canExecute) onExecuteTask?.(task.id)
                      }}
                      aria-label={task.column === 'building' ? 'Stop task' : 'Run task'}
                      className={cn(
                        'h-7 w-7 p-0 cursor-pointer disabled:opacity-50',
                        task.column === 'building'
                          ? 'text-red-400 hover:bg-red-500/20'
                          : 'text-zinc-400 hover:bg-white/[0.08]',
                      )}
                    >
                      {isExecuting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : task.column === 'building' ? (
                        <Square className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </SimpleTooltip>
                ) : null}

                {/* Overflow menu for remaining actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="More actions"
                      className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06]"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {/* Assign */}
                    {onAssign && collaborators.length > 0 && (
                      <>
                        <DropdownMenuItem
                          onSelect={(e) => e.preventDefault()}
                          className="flex flex-col items-start gap-1 py-2"
                        >
                          <span className="text-xs text-muted-foreground">Assign to</span>
                          <Select
                            onValueChange={(value) => {
                              onAssign(task.issueNumber, [value])
                            }}
                          >
                            <SelectTrigger className="w-full h-7 text-xs">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              {collaborators
                                .filter((c) => !task.assignees?.some((a) => a.login === c.login))
                                .map((collaborator) => (
                                  <SelectItem
                                    key={collaborator.login}
                                    value={collaborator.login}
                                    className="flex items-center gap-2"
                                  >
                                    <Avatar className="h-5 w-5">
                                      <AvatarImage src={collaborator.avatar_url} />
                                      <AvatarFallback className="text-[8px]">
                                        {collaborator.login[0]?.toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                    {collaborator.login}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {/* Edit — only for backlog items */}
                    {onEditTask && task.column === 'open' && (
                      <DropdownMenuItem
                        onClick={() => {
                          onEditTask(task)
                        }}
                      >
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit task
                      </DropdownMenuItem>
                    )}

                    {/* Duplicate */}
                    {onDuplicate && (
                      <DropdownMenuItem
                        onClick={() => {
                          onDuplicate(task)
                        }}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Duplicate task
                      </DropdownMenuItem>
                    )}

                    {/* Rerun */}
                    {onRerun && (
                      <DropdownMenuItem
                        onClick={() => {
                          onRerun(task)
                        }}
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Rerun
                      </DropdownMenuItem>
                    )}

                    {/* Queue toggle */}
                    {onToggleQueue &&
                      (() => {
                        const isQueued = task.labels.includes('kody:queued')
                        const isQueueActive = task.labels.includes('kody:queue-active')
                        const isQueueFailed = task.labels.includes('kody:queue-failed')
                        if (isQueueActive) return null
                        return (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                onToggleQueue(task)
                              }}
                            >
                              <ListPlus className="w-4 h-4 mr-2" />
                              {isQueued
                                ? 'Remove from queue'
                                : isQueueFailed
                                  ? 'Re-add to queue'
                                  : 'Add to queue'}
                            </DropdownMenuItem>
                          </>
                        )
                      })()}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Animated status bar — shows pipeline progress with smooth animations */}
            {isActive && (
              <div className="pb-3 px-4 pl-[52px] sm:block hidden">
                <AnimatedStatusBar task={task} />
              </div>
            )}

            {/* Non-active states: show compact animated bar for visual status at a glance */}
            {!isActive && task.column !== 'open' && (
              <div className="pb-2 px-4 pl-[52px]">
                <AnimatedStatusBar task={task} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
