/**
 * @fileType component
 * @domain kody
 * @pattern goal-grouped-view
 * @ai-summary Goal-first task list. Groups tasks by their `goal:<id>` label
 *   into collapsible goal sections (with progress + actions) and a final
 *   "Ungrouped" bucket for tasks without any goal label. Wraps the existing
 *   TaskList per section so row behavior stays identical.
 */
'use client'

import { useMemo, useState } from 'react'
import {
  Bug,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Flag,
  Inbox,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '@dashboard/ui/button'
import { cn } from '../utils'
import type { KodyTask } from '../types'
import type { Goal } from '../api'
import { GOAL_LABEL_PREFIX } from '../goals'
import { goalPalette } from '../goal-palette'
import { TaskList } from './TaskList'

interface GoalGroupedViewProps {
  goals: Goal[]
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
  onCreateGoal?: () => void
  onEditGoal?: (goal: Goal) => void
  onDeleteGoal?: (goal: Goal) => void
  /** Create a task scoped to this goal (or null for Ungrouped). */
  onCreateTaskInGoal?: (goal: Goal | null) => void
  /** Report a bug scoped to this goal (or null for Ungrouped). */
  onReportBugInGoal?: (goal: Goal | null) => void
  /** Move a task between goals (null targetGoalId = Ungrouped). */
  onMoveTask?: (task: KodyTask, targetGoalId: string | null) => void
}

interface Group {
  key: string
  goal: Goal | null
  tasks: KodyTask[]
  done: number
}

function buildGroups(goals: Goal[], tasks: KodyTask[]): Group[] {
  const byGoal = new Map<string, KodyTask[]>()
  const ungrouped: KodyTask[] = []

  for (const task of tasks) {
    const goalLabels = task.labels.filter((l) => l.startsWith(GOAL_LABEL_PREFIX))
    if (goalLabels.length === 0) {
      ungrouped.push(task)
      continue
    }
    for (const label of goalLabels) {
      const id = label.slice(GOAL_LABEL_PREFIX.length)
      const bucket = byGoal.get(id) ?? []
      bucket.push(task)
      byGoal.set(id, bucket)
    }
  }

  const goalGroups: Group[] = goals.map((goal) => {
    const attached = byGoal.get(goal.id) ?? []
    const done = attached.filter(
      (t) => t.state === 'closed' || t.column === 'done',
    ).length
    return { key: `goal:${goal.id}`, goal, tasks: attached, done }
  })

  const ungroupedDone = ungrouped.filter(
    (t) => t.state === 'closed' || t.column === 'done',
  ).length

  return [
    ...goalGroups,
    {
      key: 'ungrouped',
      goal: null,
      tasks: ungrouped,
      done: ungroupedDone,
    },
  ]
}

interface DueChip {
  label: string
  /** Tailwind bg/text classes for the chip */
  className: string
}

function describeDueDate(iso: string | undefined): DueChip | null {
  if (!iso) return null
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return null

  const now = new Date()
  // Compare by calendar day (ignore time-of-day drift)
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msPerDay = 24 * 60 * 60 * 1000
  const diffDays = Math.round(
    (dueDay.getTime() - today.getTime()) / msPerDay,
  )

  if (diffDays < 0) {
    const n = Math.abs(diffDays)
    return {
      label: n === 1 ? 'Overdue 1d' : `Overdue ${n}d`,
      className: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
    }
  }
  if (diffDays === 0) {
    return {
      label: 'Due today',
      className: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    }
  }
  if (diffDays <= 3) {
    return {
      label: `In ${diffDays}d`,
      className: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    }
  }
  return {
    label: `In ${diffDays}d`,
    className: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  }
}

export function GoalGroupedView({
  goals,
  tasks,
  onCreateGoal,
  onEditGoal,
  onDeleteGoal,
  onCreateTaskInGoal,
  onReportBugInGoal,
  onMoveTask,
  ...taskListProps
}: GoalGroupedViewProps) {
  const [dragTask, setDragTask] = useState<KodyTask | null>(null)
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  const groups = useMemo(() => buildGroups(goals, tasks), [goals, tasks])
  // Collapse "Ungrouped" by default when goals exist; keep goals expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (goals.length > 0) initial.add('ungrouped')
    return initial
  })

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const hasAnyTask = tasks.length > 0
  const visibleGroups = groups.filter(
    (g) => g.tasks.length > 0 || g.goal !== null,
  )

  if (!hasAnyTask && goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] flex items-center justify-center">
          <Flag className="w-6 h-6 text-muted-foreground/40" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No goals yet</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Create a goal to group work toward an outcome, or add a task — it
            will show up under &quot;Ungrouped&quot; until you attach it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onCreateGoal ? (
            <Button size="sm" onClick={onCreateGoal} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              New goal
            </Button>
          ) : null}
          {taskListProps.onCreateTask ? (
            <Button
              size="sm"
              variant="outline"
              onClick={taskListProps.onCreateTask}
            >
              + New task
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  const allKeys = visibleGroups.map((g) => g.key)
  const allCollapsed =
    allKeys.length > 0 && allKeys.every((k) => collapsed.has(k))
  const handleExpandAll = () => setCollapsed(new Set())
  const handleCollapseAll = () => setCollapsed(new Set(allKeys))

  return (
    <div>
      {/* Expand / collapse toolbar */}
      {visibleGroups.length > 1 ? (
        <div className="flex items-center justify-end gap-1 px-4 md:px-6 py-2 border-b border-white/[0.04] bg-black/10">
          <Button
            variant="ghost"
            size="sm"
            onClick={allCollapsed ? handleExpandAll : handleCollapseAll}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {allCollapsed ? (
              <>
                <ChevronsUpDown className="w-3.5 h-3.5" />
                Expand all
              </>
            ) : (
              <>
                <ChevronsDownUp className="w-3.5 h-3.5" />
                Collapse all
              </>
            )}
          </Button>
        </div>
      ) : null}

      <div className="space-y-4 md:space-y-5 px-2 md:px-4 pt-3">
        {visibleGroups.map((group) => {
          const isCollapsed = collapsed.has(group.key)
          const isUngrouped = group.goal === null
          const total = group.tasks.length
          const pct = total > 0 ? (group.done / total) * 100 : 0
          const targetGoalId = group.goal?.id ?? null
          const palette = group.goal ? goalPalette(group.goal.id) : null
          const isDragSource =
            dragTask !== null &&
            (isUngrouped
              ? dragTask.labels.every((l) => !l.startsWith(GOAL_LABEL_PREFIX))
              : dragTask.labels.includes(`${GOAL_LABEL_PREFIX}${targetGoalId}`))
          const canDropHere = dragTask !== null && !isDragSource
          const isHotDropZone = canDropHere && dropTargetKey === group.key
          return (
            <section
              key={group.key}
              aria-label={group.goal?.name ?? 'Ungrouped'}
              onDragOver={(e) => {
                if (!canDropHere || !onMoveTask) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dropTargetKey !== group.key) setDropTargetKey(group.key)
              }}
              onDragLeave={(e) => {
                // Only clear if leaving the section entirely
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setDropTargetKey((k) => (k === group.key ? null : k))
                }
              }}
              onDrop={(e) => {
                if (!canDropHere || !onMoveTask || !dragTask) return
                e.preventDefault()
                onMoveTask(dragTask, targetGoalId)
                setDragTask(null)
                setDropTargetKey(null)
              }}
              className={cn(
                'relative rounded-xl overflow-hidden ring-1 transition-all',
                palette
                  ? cn(palette.ring, palette.cardBg)
                  : 'ring-white/[0.06] bg-white/[0.01]',
                isHotDropZone &&
                  (palette
                    ? cn('ring-2', palette.hotRing, palette.glow)
                    : 'ring-2 ring-white/30'),
                canDropHere &&
                  !isHotDropZone &&
                  (palette
                    ? cn(palette.hintRing, 'ring-dashed')
                    : 'ring-white/20 ring-dashed'),
              )}
            >
              <header
                className={cn(
                  'relative flex items-center gap-3 px-4 md:px-6 py-4 md:py-5 transition-colors',
                  palette ? palette.headerBg : 'bg-black/30',
                )}
              >

                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left group"
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
                  )}
                  <span
                    className={cn(
                      'w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center shrink-0 ring-1',
                      palette
                        ? palette.tile
                        : 'bg-white/[0.04] ring-white/[0.06] text-muted-foreground',
                    )}
                  >
                    {isUngrouped ? (
                      <Inbox className="w-4 h-4" />
                    ) : (
                      <Flag className="w-4 h-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'text-base md:text-lg font-semibold truncate',
                          isUngrouped ? 'text-foreground/80' : 'text-foreground',
                        )}
                      >
                        {group.goal?.name ?? 'Ungrouped'}
                      </span>
                      {total > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400/70" />
                          {group.done}/{total}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground shrink-0">
                          empty
                        </span>
                      )}
                      {(() => {
                        const chip = describeDueDate(group.goal?.dueDate)
                        if (!chip) return null
                        return (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0',
                              chip.className,
                            )}
                            title={`Due ${new Date(group.goal!.dueDate!).toLocaleDateString()}`}
                          >
                            <Calendar className="w-3 h-3" />
                            {chip.label}
                          </span>
                        )
                      })()}
                    </div>
                    {/* One-line description */}
                    {group.goal?.description?.trim() ? (
                      <p
                        className="text-xs text-muted-foreground truncate max-w-2xl"
                        title={group.goal.description}
                      >
                        {group.goal.description.split('\n')[0]}
                      </p>
                    ) : null}
                    {/* Progress bar beneath the title */}
                    {group.goal && palette && total > 0 ? (
                      <div className="w-full max-w-sm h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className={cn(
                            'h-full bg-gradient-to-r transition-[width] duration-500',
                            palette.progress,
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                </button>

                {/* Goal management actions (edit / delete) — creation lives in the card footer */}
                {group.goal ? (
                  <div className="flex items-center gap-1 shrink-0">
                    {onEditGoal ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => onEditGoal(group.goal!)}
                        aria-label={`Edit ${group.goal.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    ) : null}
                    {onDeleteGoal ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                        onClick={() => onDeleteGoal(group.goal!)}
                        aria-label={`Delete ${group.goal.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </header>

              {!isCollapsed ? (
                <div className={cn(!isUngrouped && 'bg-background/40')}>
                  {total > 0 ? (
                    <TaskList
                      tasks={group.tasks}
                      {...taskListProps}
                      draggable={!!onMoveTask}
                      onDragStartTask={(task) => setDragTask(task)}
                      onDragEndTask={() => {
                        setDragTask(null)
                        setDropTargetKey(null)
                      }}
                    />
                  ) : (
                    <div className="px-4 md:px-6 py-5 text-center">
                      <p className="text-xs text-muted-foreground">
                        No tasks yet — create one below or drag a task here.
                      </p>
                    </div>
                  )}
                  {/* Footer — dashed New task / Report bug actions, always visible */}
                  {onCreateTaskInGoal || onReportBugInGoal ? (
                    <div
                      className={cn(
                        'grid gap-2 p-3 border-t',
                        onCreateTaskInGoal && onReportBugInGoal
                          ? 'grid-cols-2'
                          : 'grid-cols-1',
                        palette
                          ? cn(palette.footerBorder, palette.footerBg)
                          : 'border-white/[0.04] bg-black/10',
                      )}
                    >
                      {onCreateTaskInGoal ? (
                        <button
                          type="button"
                          onClick={() => onCreateTaskInGoal(group.goal)}
                          className={cn(
                            'group flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-white/[0.1] bg-white/[0.01] text-muted-foreground text-sm transition-colors',
                            palette
                              ? palette.createHover
                              : 'hover:border-white/30 hover:text-foreground',
                          )}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          New task
                        </button>
                      ) : null}
                      {onReportBugInGoal ? (
                        <button
                          type="button"
                          onClick={() => onReportBugInGoal(group.goal)}
                          className="group flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-white/[0.1] bg-white/[0.01] text-muted-foreground text-sm hover:border-rose-500/40 hover:bg-rose-500/[0.04] hover:text-rose-300 transition-colors"
                        >
                          <Bug className="w-3.5 h-3.5" />
                          Report bug
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      {/* Big dashed "+ New goal" footer */}
      {onCreateGoal ? (
        <div className="p-4 md:p-6">
          <button
            type="button"
            onClick={onCreateGoal}
            className="w-full group flex items-center justify-center gap-3 py-6 md:py-8 rounded-xl border-2 border-dashed border-white/[0.08] bg-white/[0.01] text-muted-foreground hover:border-sky-500/40 hover:bg-sky-500/[0.04] hover:text-sky-300 transition-colors"
          >
            <span className="w-8 h-8 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08] flex items-center justify-center group-hover:bg-sky-500/10 group-hover:ring-sky-500/40 transition-colors">
              <Plus className="w-4 h-4" />
            </span>
            <span className="text-sm font-medium">New goal</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
