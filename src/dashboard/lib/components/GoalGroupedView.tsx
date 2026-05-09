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

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  Bug,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Flag,
  GitBranch,
  GitPullRequest,
  GripVertical,
  Inbox,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@dashboard/ui/button'
import { cn } from '../utils'
import type { KodyTask } from '../types'
import type { Goal } from '../api'
import { GOAL_LABEL_PREFIX } from '../goals'
import { goalPalette } from '../goal-palette'
import { useReorderGoals } from '../hooks/useGoals'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { useGoalState, useSetGoalState } from '../hooks/useGoalState'
import { formatTickAge } from '../goal-state'
import { TaskList } from './TaskList'
import { GoalProgressRing } from './GoalProgressRing'

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
  /** Open the goal's discussion thread (modal). */
  onOpenGoalDiscussion?: (goal: Goal) => void
  /** Open the planner chat scoped to this goal (Pass 1 → approve → Pass 2 creates issues). */
  onPlanGoal?: (goal: Goal) => void
  /** Create a task scoped to this goal (or null for Ungrouped). */
  onCreateTaskInGoal?: (goal: Goal | null) => void
  /** Report a bug scoped to this goal (or null for Ungrouped). */
  onReportBugInGoal?: (goal: Goal | null) => void
  /** Move a task between goals (null targetGoalId = Ungrouped). */
  onMoveTask?: (task: KodyTask, targetGoalId: string | null) => void
  /** Collapsed group keys. Drive this with {@link useGoalCollapse}. */
  collapsed: Set<string>
  /** Toggle a single group's collapsed state. */
  onToggleCollapsed: (key: string) => void
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

/**
 * Engine bookkeeping chips for a goal row: umbrella issue, goal branch, and
 * goal PR. Sourced from `.kody/goals/<id>/state.json` (hydrated server-side
 * onto the Goal in `app/api/kody/goals/route.ts`). The branch chip renders
 * as soon as the umbrella exists — the engine creates `goal-<id>` on the
 * first task PR merge, but the umbrella issue appears on the first tick, so
 * we render the branch link optimistically (404s surface as a normal "no
 * such branch" page on github.com, no worse than today's behaviour).
 */
function GoalEngineChips({
  goal,
  connectedRepo,
}: {
  goal: Goal
  connectedRepo: string | null
}) {
  if (!goal.goalIssueNumber && !goal.goalPrUrl) return null
  const repoBase = connectedRepo ? `https://github.com/${connectedRepo}` : null
  const branch = `goal-${goal.id}`
  const branchUrl = repoBase ? `${repoBase}/tree/${encodeURIComponent(branch)}` : null
  const umbrellaUrl =
    repoBase && goal.goalIssueNumber
      ? `${repoBase}/issues/${goal.goalIssueNumber}`
      : null
  return (
    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
      {umbrellaUrl ? (
        <a
          href={umbrellaUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/20"
          title={`Umbrella issue #${goal.goalIssueNumber}`}
        >
          <CircleDot className="w-3 h-3" />
          {`#${goal.goalIssueNumber}`}
        </a>
      ) : null}
      {branchUrl ? (
        <a
          href={branchUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/20 max-w-[18rem] truncate"
          title={`Goal branch ${branch}`}
        >
          <GitBranch className="w-3 h-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </a>
      ) : null}
      {goal.goalPrUrl ? (
        <a
          href={goal.goalPrUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/30 hover:bg-violet-500/20"
          title="Goal PR"
        >
          <GitPullRequest className="w-3 h-3" />
          Goal PR
        </a>
      ) : null}
    </div>
  )
}

/**
 * Controller hook for goal collapse state. Extracted so the toggle button can
 * live outside the list (e.g. in the Kody status banner) while rows read/write
 * the same state.
 *
 * Why: the view itself and the expand/collapse toolbar need to agree on
 * `visibleGroups` to compute `allCollapsed`. Sharing this hook keeps them
 * honest without prop-drilling the full groups array.
 */
export function useGoalCollapse(goals: Goal[], tasks: KodyTask[]) {
  const groups = useMemo(() => buildGroups(goals, tasks), [goals, tasks])
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.tasks.length > 0 || g.goal !== null),
    [groups],
  )

  // Collapse "Ungrouped" by default when goals exist; keep goals expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (goals.length > 0) initial.add('ungrouped')
    return initial
  })

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const allKeys = visibleGroups.map((g) => g.key)
  const allCollapsed =
    allKeys.length > 0 && allKeys.every((k) => collapsed.has(k))
  const expandAll = useCallback(() => setCollapsed(new Set()), [])
  const collapseAll = useCallback(
    () => setCollapsed(new Set(allKeys)),
    [allKeys],
  )

  return {
    collapsed,
    toggle,
    allCollapsed,
    expandAll,
    collapseAll,
    hasMultipleGroups: visibleGroups.length > 1,
  }
}

export function GoalGroupedView({
  goals,
  tasks,
  onCreateGoal,
  onEditGoal,
  onDeleteGoal,
  onOpenGoalDiscussion,
  onPlanGoal,
  onCreateTaskInGoal,
  onReportBugInGoal,
  onMoveTask,
  collapsed,
  onToggleCollapsed,
  ...taskListProps
}: GoalGroupedViewProps) {
  const [dragTask, setDragTask] = useState<KodyTask | null>(null)
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  const groups = useMemo(() => buildGroups(goals, tasks), [goals, tasks])
  const toggle = onToggleCollapsed

  const { githubUser, connectedRepo } = useGitHubIdentity()
  const reorderMutation = useReorderGoals(githubUser?.login)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const handleGoalDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = goals.findIndex((g) => g.id === active.id)
    const newIndex = goals.findIndex((g) => g.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(goals, oldIndex, newIndex)
    reorderMutation.mutate(next.map((g) => g.id))
  }

  const hasAnyTask = tasks.length > 0
  const visibleGroups = groups.filter(
    (g) => g.tasks.length > 0 || g.goal !== null,
  )
  const sortableGoalIds = useMemo(
    () =>
      visibleGroups
        .filter((g): g is Group & { goal: Goal } => g.goal !== null)
        .map((g) => g.goal.id),
    [visibleGroups],
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

  const renderSection = (group: Group, handleProps?: HandleProps) => {
    const isCollapsed = collapsed.has(group.key)
    const isUngrouped = group.goal === null
    const total = group.tasks.length
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
                {handleProps ? (
                  <button
                    type="button"
                    aria-label={`Reorder ${group.goal?.name ?? 'group'}`}
                    className="touch-none cursor-grab active:cursor-grabbing -ml-2 px-1 py-1 text-muted-foreground/50 hover:text-foreground"
                    {...handleProps}
                  >
                    <GripVertical className="w-4 h-4" />
                  </button>
                ) : null}

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
                      <GoalProgressRing
                        done={group.done}
                        total={total}
                        paletteKey={palette?.key}
                      />
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
                    {/* Engine-owned bookkeeping: surface the umbrella issue,
                        the goal branch, and the goal PR (when present) so
                        the goal's branch location is visible without the
                        operator having to dig into state.json. */}
                    {group.goal ? (
                      <GoalEngineChips
                        goal={group.goal}
                        connectedRepo={connectedRepo}
                      />
                    ) : null}
                  </div>
                </button>

                {/* Goal management actions (run / plan / discussion / edit / delete) — creation lives in the card footer */}
                {group.goal ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <RunGoalButton goal={group.goal} taskCount={total} />
                    {onPlanGoal ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-sky-400"
                        onClick={() => onPlanGoal(group.goal!)}
                        aria-label={`Plan tasks for ${group.goal.name}`}
                        title="Plan with chat — propose tasks from this goal's description, then create them on approval"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                      </Button>
                    ) : null}
                    {onOpenGoalDiscussion ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-sky-400"
                        onClick={() => onOpenGoalDiscussion(group.goal!)}
                        aria-label={`Open ${group.goal.name} discussion`}
                        title="Open discussion"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </Button>
                    ) : null}
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
                <div
                  className={cn(
                    !isUngrouped &&
                      (palette ? palette.rowBg : 'bg-background/40'),
                  )}
                >
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
                      accent={
                        palette
                          ? {
                              divide: palette.divide,
                              rowBg: palette.rowBg,
                              rowHover: palette.rowHover,
                            }
                          : undefined
                      }
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
  }

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleGoalDragEnd}
      >
        <SortableContext
          items={sortableGoalIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4 md:space-y-5 px-2 md:px-4 pt-3">
            {visibleGroups.map((group) =>
              group.goal ? (
                <SortableGoalWrapper key={group.key} id={group.goal.id}>
                  {(handleProps) => renderSection(group, handleProps)}
                </SortableGoalWrapper>
              ) : (
                <div key={group.key}>{renderSection(group)}</div>
              ),
            )}
          </div>
        </SortableContext>
      </DndContext>

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

/**
 * Self-contained run/pause/done button per goal. Owns its own state fetch
 * and mutation, so the parent doesn't need to know about runtime state.
 *
 * UX shape:
 *   • taskCount === 0  → hidden (planner button is the only sensible action).
 *   • state == null     → "Run" (filled).
 *   • state == "active" → "Pause" (ghost).
 *   • state == "paused" → "Resume" (filled).
 *   • state == "done"   → "Done" (disabled).
 */
function RunGoalButton({
  goal,
  taskCount,
}: {
  goal: Goal
  taskCount: number
}) {
  const { githubUser } = useGitHubIdentity()
  const { data: state, isLoading } = useGoalState(goal.id)
  const setState = useSetGoalState(goal.id, githubUser?.login ?? null)

  if (taskCount === 0) return null

  const current = state?.state ?? null
  const isActive = current === 'active'
  const isPaused = current === 'paused'
  const isDone = current === 'done'
  const pending = setState.isPending || isLoading

  const onClick = () => {
    if (isDone || pending) return
    if (isActive) {
      setState.mutate({ state: 'paused' })
    } else {
      setState.mutate({ state: 'active' })
    }
  }

  const label = isDone
    ? 'Done'
    : isActive
      ? 'Pause'
      : isPaused
        ? 'Resume'
        : 'Run'
  const Icon = isDone ? CheckCircle : isActive ? Pause : Play
  const title = isDone
    ? 'All tasks completed'
    : isActive
      ? 'Pause the goal runner'
      : isPaused
        ? 'Resume the goal runner'
        : 'Start the goal runner — engine will drive each task to a merged PR'

  // Match sibling buttons (Sparkles / MessageSquare / Pencil / Trash2):
  // ghost variant, 32×32 icon-only, muted text with a colored hover. Running
  // state gets a subtle emerald tint so it's still readable at a glance.
  //
  // Companion "ticked Xm ago" indicator: only shown once the runner is real
  // (active or paused). Hidden when never-started or done — those states
  // already read clearly from the button alone.
  const tickAge =
    state && (current === 'active' || current === 'paused')
      ? formatTickAge(state.updatedAt)
      : null

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        disabled={isDone || pending}
        onClick={onClick}
        className={cn(
          'h-8 w-8 p-0 transition-colors',
          isDone
            ? 'text-emerald-400/60 cursor-default'
            : isActive
              ? 'text-emerald-400 hover:text-emerald-300'
              : 'text-muted-foreground hover:text-emerald-400',
        )}
        aria-label={`${label} ${goal.name}`}
        title={title}
      >
        <Icon className="w-3.5 h-3.5" />
      </Button>
      {tickAge ? (
        <span
          className="hidden lg:inline text-[11px] text-muted-foreground tabular-nums whitespace-nowrap"
          title={`Last tick at ${state?.updatedAt ?? ''}`}
        >
          {tickAge}
        </span>
      ) : null}
    </div>
  )
}

type HandleProps = Record<string, unknown>

function SortableGoalWrapper({
  id,
  children,
}: {
  id: string
  children: (handleProps: HandleProps) => ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  )
}
