/**
 * @fileType component
 * @domain kody
 * @pattern goal-control-page
 * @ai-summary Goals panel — list, view, create, edit, and delete goals.
 *   Goals are JSON entries stored inside a manifest GitHub issue labelled
 *   `kody:goals-manifest`. Task linkage (via `goal:<slug>` labels) is a later phase.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  CircleDashed,
  ExternalLink,
  Flag,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
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
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { AuthGuard } from "../auth-guard";
import { cn } from "../utils";
import { autoDirProps } from "../text-direction";
import {
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useReorderGoals,
  useUpdateGoal,
} from "../hooks/useGoals";
import { useKodyTasks } from "../hooks";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { tasksApi, type Goal } from "../api";
import type { KodyTask } from "../types";
import { GOAL_LABEL_PREFIX } from "../goals";
import { getGitHubIssueUrl } from "../constants";
import { ConfirmDialog } from "./ConfirmDialog";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { TaskList } from "./TaskList";
import { GoalDiscussion } from "./GoalDiscussion";
import { GoalAssigneePicker } from "./GoalAssigneePicker";
import { KodyChat } from "./KodyChat";

interface GoalProgress {
  total: number;
  done: number;
  tasks: KodyTask[];
}

function computeProgress(tasks: KodyTask[]): GoalProgress {
  const done = tasks.filter(
    (t) => t.state === "closed" || t.column === "done",
  ).length;
  return { total: tasks.length, done, tasks };
}

export function GoalControl({
  titleSlot,
}: { titleSlot?: React.ReactNode } = {}) {
  return (
    <AuthGuard>
      <GoalControlInner titleSlot={titleSlot} />
    </AuthGuard>
  );
}

export function GoalControlInner({
  titleSlot,
}: {
  titleSlot?: React.ReactNode;
}) {
  const {
    data: goals = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useGoals();
  const { data: tasks = [] } = useKodyTasks();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Goal | null>(null);

  const selectedGoal = useMemo(
    () => goals.find((g) => g.id === selectedId) ?? null,
    [goals, selectedId],
  );

  const progressByGoal = useMemo(() => {
    const map = new Map<string, GoalProgress>();
    for (const goal of goals) {
      const label = `${GOAL_LABEL_PREFIX}${goal.id}`;
      const attached = tasks.filter((t) => t.labels.includes(label));
      map.set(goal.id, computeProgress(attached));
    }
    return map;
  }, [goals, tasks]);

  useEffect(() => {
    if (!selectedId && goals.length > 0) {
      setSelectedId(goals[0].id);
    }
  }, [goals, selectedId]);

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteGoal(githubUser?.login);
  const reorderMutation = useReorderGoals(githubUser?.login);

  const sensors = useSensors(
    // Pointer (mouse): require small movement so a click still selects.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch: long-press to start dragging, so vertical scroll still works.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = goals.findIndex((g) => g.id === active.id);
    const newIndex = goals.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(goals, oldIndex, newIndex);
    reorderMutation.mutate(next.map((g) => g.id));
  };

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between gap-2 px-3 md:px-6 py-2 md:py-4 border-b border-white/[0.06] bg-black/20">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm shrink-0"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <span className="hidden sm:block h-4 w-px bg-border" />
          {titleSlot ?? (
            <h1 className="inline-flex items-center gap-2 text-lg md:text-xl font-semibold">
              <Flag className="w-5 h-5 text-sky-400" />
              Goals
            </h1>
          )}
          <span className="hidden md:inline text-xs text-muted-foreground">
            {goals.length} {goals.length === 1 ? "goal" : "goals"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh goals"
          >
            <RefreshCw
              className={cn("w-4 h-4", isFetching && "animate-spin")}
            />
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New goal</span>
          </Button>
        </div>
      </header>

      {error ? (
        <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          Failed to load goals: {(error as Error).message}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        <aside
          className={cn(
            "w-full md:w-80 md:border-r md:border-border overflow-y-auto",
            selectedGoal && "hidden md:block",
          )}
        >
          {isLoading ? (
            <EmptyState icon={<Flag />} title="Loading goals…" />
          ) : goals.length === 0 ? (
            <EmptyState
              icon={<Flag />}
              title="No goals yet"
              hint="Create your first goal to describe an outcome the system is working toward."
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={goals.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="divide-y divide-border">
                  {goals.map((goal) => {
                    const progress = progressByGoal.get(goal.id) ?? {
                      total: 0,
                      done: 0,
                      tasks: [],
                    };
                    return (
                      <SortableGoalItem
                        key={goal.id}
                        goal={goal}
                        progress={progress}
                        selected={selectedId === goal.id}
                        onSelect={() => setSelectedId(goal.id)}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </aside>

        <section
          className={cn(
            "flex-1 min-w-0 overflow-y-auto",
            !selectedGoal && "hidden md:block",
          )}
        >
          {selectedGoal ? (
            <GoalDetail
              goal={selectedGoal}
              allTasks={tasks}
              progress={
                progressByGoal.get(selectedGoal.id) ?? {
                  total: 0,
                  done: 0,
                  tasks: [],
                }
              }
              onBack={() => setSelectedId(null)}
              onEdit={() => setEditingGoal(selectedGoal)}
              onDelete={() => setPendingDelete(selectedGoal)}
            />
          ) : (
            <EmptyState
              icon={<Flag />}
              title="Select a goal"
              hint="Pick a goal from the list to see its description and details."
            />
          )}
        </section>
      </div>

      <CreateGoalDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(goal) => {
          setSelectedId(goal.id);
          setShowCreate(false);
        }}
      />

      {editingGoal ? (
        <EditGoalDialog
          goal={editingGoal}
          onClose={() => setEditingGoal(null)}
          onSaved={() => setEditingGoal(null)}
        />
      ) : null}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove this goal?"
        description={
          pendingDelete
            ? `Goal "${pendingDelete.name}" will be removed from the manifest. Tasks labelled with this goal keep their labels (you can clean them up on GitHub).`
            : ""
        }
        variant="destructive"
        confirmLabel="Remove goal"
        onConfirm={() => {
          if (!pendingDelete) return;
          const target = pendingDelete;
          deleteMutation.mutate(target.id, {
            onSuccess: () => {
              if (selectedId === target.id) setSelectedId(null);
            },
          });
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function GoalDetail({
  goal,
  allTasks,
  progress,
  onBack,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  allTasks: KodyTask[];
  progress: GoalProgress;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showAttach, setShowAttach] = useState(false);
  const [showPlanner, setShowPlanner] = useState(false);
  // Stable session id per "Plan this goal" launch — KodyChat keys its
  // ephemeral planner messages on this. New id each open = fresh thread.
  const [plannerSessionId, setPlannerSessionId] = useState<string | null>(null);
  const { githubUser } = useGitHubIdentity();
  const assigneeMutation = useUpdateGoal(goal.id, githubUser?.login);
  const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  const inProgressTasks = progress.tasks.filter(
    (t) => !(t.state === "closed" || t.column === "done"),
  );
  const doneTasks = progress.tasks.filter(
    (t) => t.state === "closed" || t.column === "done",
  );
  const attachedIds = new Set(progress.tasks.map((t) => t.issueNumber));

  return (
    <article className="min-h-full">
      {/* Hero */}
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-sky-500/[0.06] via-sky-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All goals
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="inline-flex items-center gap-2 text-xs text-sky-400 font-medium uppercase tracking-wider">
                <Flag className="w-3.5 h-3.5" />
                Goal
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                {goal.name}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                {typeof goal.discussionNumber === "number" ? (
                  <>
                    <span
                      className="font-mono opacity-80"
                      title="Goal id — mention #{number} or goal:{number} in chat to direct the conversation here"
                    >
                      #{goal.discussionNumber}
                    </span>
                    <span>·</span>
                  </>
                ) : null}
                <span>
                  created {new Date(goal.createdAt).toLocaleDateString()}
                </span>
                {goal.dueDate ? (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      due {formatDueDate(goal.dueDate)}
                    </span>
                  </>
                ) : null}
                <span>·</span>
                <GoalAssigneePicker
                  variant="compact"
                  value={goal.assignee ?? null}
                  pending={assigneeMutation.isPending}
                  onChange={(login) =>
                    assigneeMutation.mutate({ assignee: login })
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="gap-1.5 text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Remove</span>
              </Button>
            </div>
          </header>

          {/* Progress card */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5 space-y-3">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl md:text-4xl font-semibold tabular-nums">
                  {Math.round(pct)}%
                </span>
                <span className="text-sm text-muted-foreground">complete</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span className="tabular-nums text-foreground font-medium">
                    {inProgressTasks.length}
                  </span>
                  in progress
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="tabular-nums text-foreground font-medium">
                    {progress.done}
                  </span>
                  done
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="tabular-nums text-foreground font-medium">
                    {progress.total}
                  </span>
                  total
                </span>
              </div>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-sky-400 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Description */}
          {goal.description?.trim() ? (
            <MarkdownPreview content={goal.description} variant="compact" />
          ) : null}
        </div>
      </div>

      {/* Discussion */}
      <div className="max-w-4xl mx-auto p-4 md:p-8 pb-0 space-y-3">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Discussion
        </h3>
        <GoalDiscussion goalId={goal.id} />
      </div>

      {/* Tasks */}
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Tasks
          </h3>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPlannerSessionId(
                  typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? crypto.randomUUID()
                    : `planner-${Date.now()}`,
                );
                setShowPlanner(true);
              }}
              className="gap-1.5"
              title="Open the planner chat: it proposes tasks from this goal's description and creates them on approval."
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              Plan with chat
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAttach(true)}
              className="gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Attach tasks
            </Button>
          </div>
        </div>

        {progress.total === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-sky-500/10 flex items-center justify-center">
              <Plus className="w-5 h-5 text-sky-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                No tasks attached yet
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Use{" "}
                <span className="font-medium text-foreground">
                  Attach tasks
                </span>{" "}
                to link open issues to this goal and start tracking progress.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {inProgressTasks.length > 0 ? (
              <TaskSection
                heading="In progress"
                count={inProgressTasks.length}
                tasks={inProgressTasks}
                onTaskSelect={(task) =>
                  task && router.push(`/${task.issueNumber}`)
                }
              />
            ) : null}
            {doneTasks.length > 0 ? (
              <TaskSection
                heading="Done"
                count={doneTasks.length}
                tasks={doneTasks}
                onTaskSelect={(task) =>
                  task && router.push(`/${task.issueNumber}`)
                }
              />
            ) : null}
          </div>
        )}
      </div>

      <AttachTasksDialog
        open={showAttach}
        goal={goal}
        availableTasks={allTasks.filter(
          (t) => !attachedIds.has(t.issueNumber) && t.state === "open",
        )}
        onClose={() => setShowAttach(false)}
      />

      <PlanGoalDialog
        open={showPlanner && plannerSessionId != null}
        goal={goal}
        sessionId={plannerSessionId ?? ""}
        existingTasks={progress.tasks.map((t) => ({
          number: t.issueNumber,
          title: t.title,
          state: t.state,
        }))}
        actorLogin={githubUser?.login ?? null}
        onTasksCreated={() => {
          // Refresh task list + goals on every successful planner turn —
          // Pass 2 typically issues several `create_task_for_goal` calls in
          // one round, so a single invalidation per stream is enough.
          queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["goals"] });
        }}
        onClose={() => setShowPlanner(false)}
      />
    </article>
  );
}

export function PlanGoalDialog({
  open,
  goal,
  sessionId,
  existingTasks,
  actorLogin,
  onTasksCreated,
  onClose,
}: {
  open: boolean;
  goal: Goal;
  sessionId: string;
  existingTasks: Array<{ number: number; title: string; state?: string }>;
  actorLogin: string | null;
  onTasksCreated: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-3xl p-0 gap-0 h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-sky-400" />
            Plan tasks for &ldquo;{goal.name}&rdquo;
          </DialogTitle>
          <DialogDescription>
            Pass 1: I propose a task list from the goal description. Pass 2
            (after you approve): I deepen each spec from the codebase and open
            the issues attached to this goal.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <KodyChat
            context={{
              kind: "goal-planner",
              goal,
              sessionId,
              existingTasks,
              onTasksCreated,
            }}
            actorLogin={actorLogin}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskSection({
  heading,
  count,
  tasks,
  onTaskSelect,
}: {
  heading: string;
  count: number;
  tasks: KodyTask[];
  onTaskSelect: (task: KodyTask | null) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
        <span>{heading}</span>
        <span className="tabular-nums opacity-70">{count}</span>
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden">
        <TaskList tasks={tasks} onTaskSelect={onTaskSelect} />
      </div>
    </section>
  );
}

export function AttachTasksDialog({
  open,
  goal,
  availableTasks,
  onClose,
}: {
  open: boolean;
  goal: Goal;
  availableTasks: KodyTask[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { githubUser } = useGitHubIdentity();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(new Set());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableTasks;
    return availableTasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || String(t.issueNumber).includes(q),
    );
  }, [availableTasks, query]);

  const toggle = (issueNumber: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(issueNumber)) next.delete(issueNumber);
      else next.add(issueNumber);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0 || pending) return;
    setPending(true);
    const label = `${GOAL_LABEL_PREFIX}${goal.id}`;
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((issueNumber) =>
        tasksApi.addLabel(issueNumber, label, githubUser?.login),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    setPending(false);

    if (ok > 0) {
      queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
      toast.success(
        `Attached ${ok} ${ok === 1 ? "task" : "tasks"} to ${goal.name}`,
      );
    }
    if (failed > 0) {
      toast.error(`${failed} ${failed === 1 ? "attach" : "attaches"} failed`);
    }
    if (failed === 0) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Attach tasks to {goal.name}</DialogTitle>
          <DialogDescription>
            Selected tasks get the{" "}
            <code className="font-mono text-xs">
              {`${GOAL_LABEL_PREFIX}${goal.id}`}
            </code>{" "}
            label so they show up under this goal.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-2">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search open tasks…"
            className="pl-8"
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {availableTasks.length === 0
                ? "No unattached open tasks."
                : "No tasks match that search."}
            </div>
          ) : (
            filtered.map((task) => {
              const isSelected = selected.has(task.issueNumber);
              return (
                <button
                  key={task.issueNumber}
                  type="button"
                  onClick={() => toggle(task.issueNumber)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent/30 transition-colors",
                    isSelected && "bg-sky-500/10",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    className="w-4 h-4 shrink-0 accent-sky-400"
                  />
                  <span className="font-mono text-xs text-muted-foreground shrink-0">
                    #{task.issueNumber}
                  </span>
                  <span
                    {...autoDirProps}
                    className="text-sm truncate flex-1 text-start"
                  >
                    {task.title}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-2">
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={selected.size === 0 || pending}
            >
              {pending
                ? "Attaching…"
                : `Attach ${selected.size || ""} ${selected.size === 1 ? "task" : "tasks"}`.trim()}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskGroup({ heading, tasks }: { heading: string; tasks: KodyTask[] }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        {heading}
      </div>
      <ul className="divide-y divide-white/[0.04] rounded-lg border border-white/[0.06] bg-white/[0.02]">
        {tasks.map((task) => {
          const isDone = task.state === "closed" || task.column === "done";
          return (
            <li
              key={task.issueNumber}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              {isDone ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono text-xs text-muted-foreground shrink-0">
                #{task.issueNumber}
              </span>
              <Link
                {...autoDirProps}
                href={`/${task.issueNumber}`}
                className="truncate flex-1 hover:text-sky-400 transition-colors text-start"
                title={task.title}
              >
                {task.title}
              </Link>
              <a
                href={getGitHubIssueUrl(task.issueNumber)}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground shrink-0"
                title="Open on GitHub"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CreateGoalDialog({
  open,
  onClose,
  onCreated,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (goal: Goal) => void;
  /** Optional pre-fill for callers that seed the dialog from another resource (e.g. a report). */
  initial?: { name?: string; description?: string; dueDate?: string };
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateGoal(githubUser?.login);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setDueDate(initial?.dueDate ?? "");
      setAssignee(null);
    }
  }, [open, initial?.name, initial?.description, initial?.dueDate]);

  const handleSubmit = () => {
    if (!name.trim() || createMutation.isPending) return;
    createMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate.trim() || undefined,
        assignee: assignee?.trim() || undefined,
      },
      {
        onSuccess: (goal) => onCreated(goal),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New goal</DialogTitle>
          <DialogDescription>
            Describe the outcome. Tasks can later be attached to this goal via a
            label.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Name</Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ship checkout rewrite"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-due">Due date (optional)</Label>
            <Input
              id="goal-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Owner (optional)</Label>
            <GoalAssigneePicker value={assignee} onChange={setAssignee} />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              rows={10}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create goal"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditGoalDialog({
  goal,
  onClose,
  onSaved,
}: {
  goal: Goal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateGoal(goal.id, githubUser?.login);

  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description ?? "");
  const [dueDate, setDueDate] = useState(goal.dueDate ?? "");
  const [assignee, setAssignee] = useState<string | null>(
    goal.assignee ?? null,
  );

  useEffect(() => {
    setName(goal.name);
    setDescription(goal.description ?? "");
    setDueDate(goal.dueDate ?? "");
    setAssignee(goal.assignee ?? null);
  }, [goal]);

  const handleSubmit = () => {
    if (!name.trim() || updateMutation.isPending) return;
    const patch: {
      name?: string;
      description?: string | null;
      dueDate?: string | null;
      assignee?: string | null;
    } = {};
    if (name.trim() !== goal.name) patch.name = name.trim();
    if ((description ?? "") !== (goal.description ?? "")) {
      patch.description = description.trim() ? description.trim() : null;
    }
    if ((dueDate ?? "") !== (goal.dueDate ?? "")) {
      patch.dueDate = dueDate.trim() ? dueDate.trim() : null;
    }
    if ((assignee ?? null) !== (goal.assignee ?? null)) {
      patch.assignee = assignee && assignee.trim() ? assignee.trim() : null;
    }
    if (Object.keys(patch).length === 0) {
      onSaved();
      return;
    }
    updateMutation.mutate(patch, { onSuccess: () => onSaved() });
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit goal</DialogTitle>
          <DialogDescription>
            Update the goal name, due date, or description. Changes are written
            back to the manifest issue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-name">Name</Label>
            <Input
              id="edit-goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-due">Due date</Label>
            <Input
              id="edit-goal-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Owner</Label>
            <GoalAssigneePicker value={assignee} onChange={setAssignee} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              rows={10}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SortableGoalItem({
  goal,
  progress,
  selected,
  onSelect,
}: {
  goal: Goal;
  progress: GoalProgress;
  selected: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: goal.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 10 : undefined,
  };

  const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("relative bg-background", isDragging && "shadow-lg")}
    >
      <div
        className={cn(
          "flex items-stretch hover:bg-accent/50 transition-colors",
          selected && "bg-accent/70",
        )}
      >
        <button
          type="button"
          aria-label={`Reorder ${goal.name}`}
          className="touch-none cursor-grab active:cursor-grabbing px-2 flex items-center text-muted-foreground/60 hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onSelect}
          className="flex-1 text-left pr-4 py-3"
        >
          <div className="font-medium text-sm truncate">
            {typeof goal.discussionNumber === "number" ? (
              <span className="font-mono text-muted-foreground">
                #{goal.discussionNumber}{" "}
              </span>
            ) : null}
            {goal.name}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <CheckCircle className="w-3 h-3" />
              {progress.done}/{progress.total}
            </span>
            {goal.dueDate ? (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDueDate(goal.dueDate)}
              </span>
            ) : null}
          </div>
          {progress.total > 0 ? (
            <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-sky-400/70 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </button>
      </div>
    </li>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 text-muted-foreground">
      <div className="w-10 h-10 mb-3 opacity-60">{icon}</div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint ? <p className="text-xs mt-1 max-w-xs">{hint}</p> : null}
    </div>
  );
}

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}
