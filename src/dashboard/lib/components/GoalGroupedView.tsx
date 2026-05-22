/**
 * @fileType component
 * @domain kody
 * @pattern goal-grouped-view
 * @ai-summary Goal-first task list. Groups tasks by their `goal:<id>` label
 *   into collapsible goal sections (with progress + actions) and a final
 *   "Ungrouped" bucket for tasks without any goal label. Wraps the existing
 *   TaskList per section so row behavior stays identical.
 */
"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  Bot,
  Bug,
  Calendar,
  ChevronDown,
  ChevronRight,
  Flag,
  GitMerge,
  GripVertical,
  Inbox,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@dashboard/ui/button";
import { cn } from "../utils";
import type { KodyTask } from "../types";
import type { Goal } from "../api";
import { GOAL_LABEL_PREFIX } from "../goals";
import { goalPalette } from "../goal-palette";
import { useReorderGoals } from "../hooks/useGoals";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import {
  useGoalState,
  useMergeGoal,
  useManageGoal,
} from "../hooks/useGoalState";
import { useClosedGoalTasks } from "../hooks/useClosedGoalTasks";
import { usePersistedSet } from "../hooks/usePersistedState";
import { TaskList } from "./TaskList";
import { GoalProgressRing } from "./GoalProgressRing";

interface GoalGroupedViewProps {
  goals: Goal[];
  tasks: KodyTask[];
  selectedTask?: KodyTask | null;
  executingTaskId?: string | null;
  mergingTaskId?: string | null;
  focusedIndex?: number;
  onTaskSelect?: (task: KodyTask | null) => void;
  onExecuteTask?: (taskId: string) => void;
  onStopTask?: (task: KodyTask) => void;
  onApproveReview?: (task: KodyTask) => Promise<void>;
  onTaskHover?: (task: KodyTask) => void;
  onAssign?: (issueNumber: number, assignees: string[]) => void;
  onUnassign?: (issueNumber: number, assignees: string[]) => void;
  collaborators?: { login: string; avatar_url: string }[];
  onOpenPreview?: (task: KodyTask) => void;
  onCreateTask?: () => void;
  onEditTask?: (task: KodyTask) => void;
  onDuplicate?: (task: KodyTask) => void;
  onRerun?: (task: KodyTask) => void;
  onToggleQueue?: (task: KodyTask) => void;
  onCreateGoal?: () => void;
  onEditGoal?: (goal: Goal) => void;
  onDeleteGoal?: (goal: Goal) => void;
  /** Open the goal's discussion thread (modal). */
  onOpenGoalDiscussion?: (goal: Goal) => void;
  /** Open the planner chat scoped to this goal (Pass 1 → approve → Pass 2 creates issues). */
  onPlanGoal?: (goal: Goal) => void;
  /** Create a task scoped to this goal (or null for Ungrouped). */
  onCreateTaskInGoal?: (goal: Goal | null) => void;
  /** Report a bug scoped to this goal (or null for Ungrouped). */
  onReportBugInGoal?: (goal: Goal | null) => void;
  /** Move a task between goals (null targetGoalId = Ungrouped). */
  onMoveTask?: (task: KodyTask, targetGoalId: string | null) => void;
  /** Collapsed group keys. Drive this with {@link useGoalCollapse}. */
  collapsed: Set<string>;
  /** Toggle a single group's collapsed state. */
  onToggleCollapsed: (key: string) => void;
}

interface Group {
  key: string;
  goal: Goal | null;
  tasks: KodyTask[];
  done: number;
}

function buildGroups(goals: Goal[], tasks: KodyTask[]): Group[] {
  const byGoal = new Map<string, KodyTask[]>();
  const ungrouped: KodyTask[] = [];

  for (const task of tasks) {
    const goalLabels = task.labels.filter((l) =>
      l.startsWith(GOAL_LABEL_PREFIX),
    );
    if (goalLabels.length === 0) {
      ungrouped.push(task);
      continue;
    }
    for (const label of goalLabels) {
      const id = label.slice(GOAL_LABEL_PREFIX.length);
      const bucket = byGoal.get(id) ?? [];
      bucket.push(task);
      byGoal.set(id, bucket);
    }
  }

  const goalGroups: Group[] = goals.map((goal) => {
    const attached = byGoal.get(goal.id) ?? [];
    const done = attached.filter(
      (t) => t.state === "closed" || t.column === "done",
    ).length;
    return { key: `goal:${goal.id}`, goal, tasks: attached, done };
  });

  const ungroupedDone = ungrouped.filter(
    (t) => t.state === "closed" || t.column === "done",
  ).length;

  return [
    ...goalGroups,
    {
      key: "ungrouped",
      goal: null,
      tasks: ungrouped,
      done: ungroupedDone,
    },
  ];
}

interface DueChip {
  label: string;
  /** Tailwind bg/text classes for the chip */
  className: string;
}

function describeDueDate(iso: string | undefined): DueChip | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  // Compare by calendar day (ignore time-of-day drift)
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / msPerDay);

  if (diffDays < 0) {
    const n = Math.abs(diffDays);
    return {
      label: n === 1 ? "Overdue 1d" : `Overdue ${n}d`,
      className: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
    };
  }
  if (diffDays === 0) {
    return {
      label: "Due today",
      className: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    };
  }
  if (diffDays <= 3) {
    return {
      label: `In ${diffDays}d`,
      className: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    };
  }
  return {
    label: `In ${diffDays}d`,
    className: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  };
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
  const groups = useMemo(() => buildGroups(goals, tasks), [goals, tasks]);
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.tasks.length > 0 || g.goal !== null),
    [groups],
  );

  // Persisted across reloads/navigation. Default (first ever visit, nothing
  // stored): collapse "Ungrouped" when goals exist, keep goals expanded.
  const {
    set: collapsed,
    has: isCollapsed,
    toggle,
    setSet: setCollapsed,
  } = usePersistedSet(
    "goals.collapse",
    new Set(goals.length > 0 ? ["ungrouped"] : []),
  );

  const allKeys = visibleGroups.map((g) => g.key);
  const allCollapsed =
    allKeys.length > 0 && allKeys.every((k) => isCollapsed(k));
  const expandAll = useCallback(
    () => setCollapsed(new Set()),
    [setCollapsed],
  );
  const collapseAll = useCallback(
    () => setCollapsed(new Set(allKeys)),
    [allKeys, setCollapsed],
  );

  return {
    collapsed,
    toggle,
    allCollapsed,
    expandAll,
    collapseAll,
    hasMultipleGroups: visibleGroups.length > 1,
  };
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
  const [dragTask, setDragTask] = useState<KodyTask | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  // Per-goal "Show closed" toggle membership. Closed tasks aren't part of the
  // main polled payload — toggling on triggers a one-off fetch via
  // `useClosedGoalTasks` for that goal only, so the global rate budget stays
  // flat regardless of how many goals exist.
  const [showClosedSet, setShowClosedSet] = useState<Set<string>>(new Set());
  const toggleShowClosed = useCallback((goalId: string) => {
    setShowClosedSet((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }, []);
  const groups = useMemo(() => buildGroups(goals, tasks), [goals, tasks]);
  const toggle = onToggleCollapsed;

  const { githubUser } = useGitHubIdentity();
  const reorderMutation = useReorderGoals(githubUser?.login);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleGoalDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = goals.findIndex((g) => g.id === active.id);
    const newIndex = goals.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(goals, oldIndex, newIndex);
    reorderMutation.mutate(next.map((g) => g.id));
  };

  const hasAnyTask = tasks.length > 0;
  const visibleGroups = groups.filter(
    (g) => g.tasks.length > 0 || g.goal !== null,
  );
  const sortableGoalIds = useMemo(
    () =>
      visibleGroups
        .filter((g): g is Group & { goal: Goal } => g.goal !== null)
        .map((g) => g.goal.id),
    [visibleGroups],
  );

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
    );
  }

  const renderSection = (group: Group, handleProps?: HandleProps) => {
    const isCollapsed = collapsed.has(group.key);
    const isUngrouped = group.goal === null;
    const total = group.tasks.length;
    const targetGoalId = group.goal?.id ?? null;
    const palette = group.goal ? goalPalette(group.goal.id) : null;
    const isDragSource =
      dragTask !== null &&
      (isUngrouped
        ? dragTask.labels.every((l) => !l.startsWith(GOAL_LABEL_PREFIX))
        : dragTask.labels.includes(`${GOAL_LABEL_PREFIX}${targetGoalId}`));
    const canDropHere = dragTask !== null && !isDragSource;
    const isHotDropZone = canDropHere && dropTargetKey === group.key;
    return (
      <section
        aria-label={group.goal?.name ?? "Ungrouped"}
        onDragOver={(e) => {
          if (!canDropHere || !onMoveTask) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dropTargetKey !== group.key) setDropTargetKey(group.key);
        }}
        onDragLeave={(e) => {
          // Only clear if leaving the section entirely
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropTargetKey((k) => (k === group.key ? null : k));
          }
        }}
        onDrop={(e) => {
          if (!canDropHere || !onMoveTask || !dragTask) return;
          e.preventDefault();
          onMoveTask(dragTask, targetGoalId);
          setDragTask(null);
          setDropTargetKey(null);
        }}
        className={cn(
          "relative rounded-xl overflow-hidden ring-1 transition-all",
          palette
            ? cn(palette.ring, palette.cardBg)
            : "ring-white/[0.06] bg-white/[0.01]",
          isHotDropZone &&
            (palette
              ? cn("ring-2", palette.hotRing, palette.glow)
              : "ring-2 ring-white/30"),
          canDropHere &&
            !isHotDropZone &&
            (palette
              ? cn(palette.hintRing, "ring-dashed")
              : "ring-white/20 ring-dashed"),
        )}
      >
        <header
          className={cn(
            "relative flex items-center gap-3 px-4 md:px-6 py-4 md:py-5 transition-colors",
            palette ? palette.headerBg : "bg-black/30",
          )}
        >
          {handleProps ? (
            <button
              type="button"
              aria-label={`Reorder ${group.goal?.name ?? "group"}`}
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
                "w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center shrink-0 ring-1",
                palette
                  ? palette.tile
                  : "bg-white/[0.04] ring-white/[0.06] text-muted-foreground",
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
                {typeof group.goal?.discussionNumber === "number" ? (
                  <span
                    className="text-base md:text-lg font-mono font-semibold text-muted-foreground shrink-0"
                    title="Goal id — mention #{number} or goal:{number} in chat to direct the conversation here"
                  >
                    #{group.goal.discussionNumber}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "text-base md:text-lg font-semibold truncate",
                    isUngrouped ? "text-foreground/80" : "text-foreground",
                  )}
                >
                  {group.goal?.name ?? "Ungrouped"}
                </span>
                <GoalProgressRing
                  done={group.done}
                  total={total}
                  paletteKey={palette?.key}
                />
                {(() => {
                  const chip = describeDueDate(group.goal?.dueDate);
                  if (!chip) return null;
                  return (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0",
                        chip.className,
                      )}
                      title={`Due ${new Date(group.goal!.dueDate!).toLocaleDateString()}`}
                    >
                      <Calendar className="w-3 h-3" />
                      {chip.label}
                    </span>
                  );
                })()}
              </div>
              {/* One-line description */}
              {group.goal?.description?.trim() ? (
                <p
                  className="text-xs text-muted-foreground truncate max-w-2xl"
                  title={group.goal.description}
                >
                  {group.goal.description.split("\n")[0]}
                </p>
              ) : null}
            </div>
          </button>

          {/* Goal management actions (run / plan / discussion / edit / delete) — creation lives in the card footer */}
          {group.goal ? (
            <div className="flex items-center gap-1 shrink-0">
              <ManageGoalButton goal={group.goal} />
              <MergeGoalButton goal={group.goal} taskCount={total} />
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 w-8 p-0 transition-colors",
                  showClosedSet.has(group.goal.id)
                    ? "text-sky-400 hover:text-sky-300"
                    : "text-muted-foreground hover:text-sky-400",
                )}
                onClick={() => toggleShowClosed(group.goal!.id)}
                aria-pressed={showClosedSet.has(group.goal.id)}
                aria-label={
                  showClosedSet.has(group.goal.id)
                    ? `Hide closed tasks in ${group.goal.name}`
                    : `Show closed tasks in ${group.goal.name}`
                }
                title={
                  showClosedSet.has(group.goal.id)
                    ? "Hide closed tasks"
                    : "Show closed tasks"
                }
              >
                <Archive className="w-3.5 h-3.5" />
              </Button>
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
              !isUngrouped && (palette ? palette.rowBg : "bg-background/40"),
            )}
          >
            {total > 0 || (group.goal && showClosedSet.has(group.goal.id)) ? (
              <GoalSectionTasks
                goalId={group.goal?.id ?? null}
                openTasks={group.tasks}
                showClosed={!!group.goal && showClosedSet.has(group.goal.id)}
                taskListProps={taskListProps}
                onMoveTask={onMoveTask}
                setDragTask={setDragTask}
                setDropTargetKey={setDropTargetKey}
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
                  "grid gap-2 p-3 border-t",
                  onCreateTaskInGoal && onReportBugInGoal
                    ? "grid-cols-2"
                    : "grid-cols-1",
                  palette
                    ? cn(palette.footerBorder, palette.footerBg)
                    : "border-white/[0.04] bg-black/10",
                )}
              >
                {onCreateTaskInGoal ? (
                  <button
                    type="button"
                    onClick={() => onCreateTaskInGoal(group.goal)}
                    className={cn(
                      "group flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-white/[0.1] bg-white/[0.01] text-muted-foreground text-sm transition-colors",
                      palette
                        ? palette.createHover
                        : "hover:border-white/30 hover:text-foreground",
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
    );
  };

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
  );
}

/**
 * "Let Kody manage this goal" toggle. When on, the `goal-manager` staff
 * member owns the goal end-to-end: it decomposes it into tasks, lets the engine
 * build them, verifies the end-to-end journey with `qa-engineer`,
 * recovers stalled tasks, and leaves ONE open deliverable PR for a human
 * to merge (the engine never auto-merges). Always available — managing a
 * goal with no tasks is the point (the staff member writes the task list).
 */
function ManageGoalButton({ goal }: { goal: Goal }) {
  const { githubUser } = useGitHubIdentity();
  const { data: state, isLoading } = useGoalState(goal.id);
  const manage = useManageGoal(goal.id, githubUser?.login ?? null);

  // A done goal can't be re-managed (deliverable PR is already open).
  if (state?.state === "done") return null;

  const isManaged = state?.managed === true;
  const pending = manage.isPending || isLoading;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!pending) manage.mutate(!isManaged);
      }}
      className={cn(
        "h-8 w-8 p-0 transition-colors",
        isManaged
          ? "text-violet-400 hover:text-violet-300"
          : "text-muted-foreground hover:text-violet-400",
      )}
      aria-label={`${isManaged ? "Disable" : "Enable"} Kody management for ${goal.name}`}
      title={
        isManaged
          ? "Kody is managing this goal end-to-end (decompose → build → QA the journey → one open PR). Click to disable."
          : "Let Kody manage this goal end-to-end: it breaks it into tasks, QA-verifies the journey, recovers stalls, and opens one PR for you to merge."
      }
    >
      {pending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Bot className="w-3.5 h-3.5" />
      )}
    </Button>
  );
}

/**
 * "Merge goal" button — only visible once the engine has parked the goal
 * at `state="awaiting-merge"` (every task done, nothing merged). Clicking
 * arms the engine's one-shot finalize, which squash-merges the cumulative
 * leaf PR into the default branch and closes the stack. Hidden in every
 * other state (the goal isn't ready to merge, or already merged → done).
 */
function MergeGoalButton({
  goal,
  taskCount,
}: {
  goal: Goal;
  taskCount: number;
}) {
  const { githubUser } = useGitHubIdentity();
  const { data: state } = useGoalState(goal.id);
  const merge = useMergeGoal(goal.id, githubUser?.login ?? null);

  if (taskCount === 0) return null;
  if (state?.state !== "awaiting-merge") return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={merge.isPending}
      onClick={() => {
        if (!merge.isPending) merge.mutate();
      }}
      className="h-8 px-2 gap-1 text-emerald-400 hover:text-emerald-300"
      aria-label={`Merge ${goal.name}`}
      title="All tasks done — squash-merge the goal's cumulative changes into the default branch and close the stack"
    >
      {merge.isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <GitMerge className="w-3.5 h-3.5" />
      )}
      <span className="text-[11px] font-medium">Merge</span>
    </Button>
  );
}

type HandleProps = Record<string, unknown>;

function SortableGoalWrapper({
  id,
  children,
}: {
  id: string;
  children: (handleProps: HandleProps) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: "relative",
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

/**
 * Per-goal task list wrapper. Owns the optional closed-tasks fetch so the
 * hook only runs when the user opens the "Show closed" toggle for THIS goal
 * — keeps the global rate budget flat regardless of how many goals exist.
 */
type GoalSectionTaskListProps = Omit<
  GoalGroupedViewProps,
  | "goals"
  | "tasks"
  | "collapsed"
  | "onToggleCollapsed"
  | "onCreateGoal"
  | "onEditGoal"
  | "onDeleteGoal"
  | "onOpenGoalDiscussion"
  | "onPlanGoal"
  | "onCreateTaskInGoal"
  | "onReportBugInGoal"
  | "onMoveTask"
>;

function GoalSectionTasks({
  goalId,
  openTasks,
  showClosed,
  taskListProps,
  onMoveTask,
  setDragTask,
  setDropTargetKey,
  accent,
}: {
  goalId: string | null;
  openTasks: KodyTask[];
  showClosed: boolean;
  taskListProps: GoalSectionTaskListProps;
  onMoveTask?: GoalGroupedViewProps["onMoveTask"];
  setDragTask: (t: KodyTask | null) => void;
  setDropTargetKey: (k: string | null) => void;
  accent?: { divide: string; rowBg: string; rowHover: string };
}) {
  const { data: closed, isFetching } = useClosedGoalTasks(
    goalId ?? "",
    showClosed && !!goalId,
  );
  const merged = useMemo(() => {
    if (!showClosed || !closed?.length) return openTasks;
    const seen = new Set(openTasks.map((t) => t.issueNumber));
    const additions = closed.filter((t) => !seen.has(t.issueNumber));
    return [...openTasks, ...additions];
  }, [openTasks, closed, showClosed]);

  return (
    <>
      <TaskList
        tasks={merged}
        {...taskListProps}
        draggable={!!onMoveTask}
        onDragStartTask={(task) => setDragTask(task)}
        onDragEndTask={() => {
          setDragTask(null);
          setDropTargetKey(null);
        }}
        accent={accent}
      />
      {showClosed && isFetching ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading closed…
        </div>
      ) : null}
      {showClosed && !isFetching && (closed?.length ?? 0) === 0 ? (
        <div className="px-4 md:px-6 py-3 text-center text-[11px] text-muted-foreground">
          No closed tasks in this goal yet.
        </div>
      ) : null}
    </>
  );
}
