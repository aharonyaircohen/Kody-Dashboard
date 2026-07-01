/**
 * @fileType component
 * @domain kody
 * @pattern task-list
 * @ai-summary Three-zone task list: color bar | title + inline metadata + assignees | actions. Pipeline progress gets its own row only when active.
 */
"use client";

import { memo, useCallback, useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn, formatRelativeTime } from "../utils";
import {
  HIDDEN_TASK_LABEL,
  KODY_BACKLOG_LABEL,
  parsePriorityLabel,
  PRIORITY_META,
} from "../constants";
import { kodyApi } from "../api";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import {
  markTaskHiddenInList,
  markTaskVisibleInList,
} from "../tasks/visibility";
import { MiniPipelineProgress } from "./MiniPipelineProgress";
import { AnimatedStatusBar } from "./v2/AnimatedStatusBar";
import { SimpleTooltip } from "./SimpleTooltip";
import { textDirectionProps } from "../text-direction";
import {
  StatusTooltipContent,
  SubStatusTooltipContent,
} from "./tooltip-content";
import { KodyPhaseChip, KodyFlowChip } from "./KodyLabelChips";
import { CIStatusBadge } from "./CIStatusBadge";
import { UIVerifyBadge } from "./UIVerifyBadge";
import { ConfirmDialog } from "./ConfirmDialog";
import type { KodyTask, ColumnId } from "../types";
import { useAuth } from "../auth-context";
import { repoScopedHref } from "../routes";
import { Button } from "@dashboard/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dashboard/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
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
  EyeOff,
  Inbox,
  Pencil,
  Copy,
  MoreHorizontal,
} from "lucide-react";

interface TaskListProps {
  tasks: KodyTask[];
  selectedTask?: KodyTask | null;
  executingTaskId?: string | null;
  mergingTaskId?: string | null;
  focusedIndex?: number;
  onTaskSelect?: (task: KodyTask | null) => void;
  onExecuteTask?: (task: KodyTask) => void;
  onStopTask?: (task: KodyTask) => void;
  onApproveReview?: (task: KodyTask) => Promise<void>;
  onTaskHover?: (task: KodyTask) => void;
  onAssign?: (issueNumber: number, assignees: string[]) => void;
  onAssignToKody?: (task: KodyTask) => void;
  onUnassignFromKody?: (task: KodyTask) => void;
  onUnassign?: (issueNumber: number, assignees: string[]) => void;
  collaborators?: { login: string; avatar_url: string }[];
  onOpenPreview?: (task: KodyTask) => void;
  onCreateTask?: () => void;
  onEditTask?: (task: KodyTask) => void;
  onDuplicate?: (task: KodyTask) => void;
  onHideTask?: (task: KodyTask) => void;
  onShowTask?: (task: KodyTask) => void;
  onRerun?: (task: KodyTask) => void;
  onToggleQueue?: (task: KodyTask) => void;
  intakeMode?: boolean;
  /** If true, each row is draggable (for goal-to-goal DnD). */
  draggable?: boolean;
  onDragStartTask?: (task: KodyTask, event: React.DragEvent) => void;
  onDragEndTask?: (task: KodyTask) => void;
  /**
   * Optional goal palette — tints dividers, hover state, and neutral-status
   * rows with the enclosing goal's accent color. Active-status rows (building,
   * review, failed, etc.) keep their meaningful colors.
   */
  accent?: {
    divide: string;
    rowBg: string;
    rowHover: string;
  };
}

// ── Status colors — single source of truth ──
const statusColors: Record<
  ColumnId,
  { dot: string; text: string; bg: string; border: string }
> = {
  open: { dot: "bg-zinc-500", text: "text-zinc-400", bg: "", border: "" },
  building: {
    dot: "bg-blue-500",
    text: "text-blue-400",
    bg: "bg-blue-500/[0.04]",
    border: "border-s-blue-500/50",
  },
  review: {
    dot: "bg-purple-500",
    text: "text-purple-400",
    bg: "bg-purple-500/[0.04]",
    border: "border-s-purple-500/50",
  },
  failed: {
    dot: "bg-red-500",
    text: "text-red-400",
    bg: "bg-red-500/[0.05]",
    border: "border-s-red-500/50",
  },
  "gate-waiting": {
    dot: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/[0.04]",
    border: "border-s-amber-500/50",
  },
  retrying: {
    dot: "bg-orange-500",
    text: "text-orange-400",
    bg: "bg-orange-500/[0.04]",
    border: "border-s-orange-500/50",
  },
  done: {
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    bg: "bg-emerald-500/[0.03]",
    border: "border-s-emerald-500/50",
  },
};

function isTaskAbortable(task: KodyTask): boolean {
  if (task.state === "closed") return false;
  if (task.pipeline?.state === "running" || task.pipeline?.state === "paused")
    return true;
  if (
    task.workflowRun?.status === "in_progress" ||
    task.workflowRun?.status === "queued"
  )
    return true;
  return (
    task.column === "building" ||
    task.column === "retrying" ||
    task.column === "gate-waiting"
  );
}

function hasTaskRunHistory(task: KodyTask): boolean {
  if (task.pipeline || task.workflowRun || task.kodyState) return true;
  return (
    task.column === "failed" ||
    task.column === "review" ||
    task.column === "done" ||
    !!task.associatedPR
  );
}

// ── Client-only relative time (prevents hydration mismatch) ──
function RelativeTime({ date }: { date: string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    setText(formatRelativeTime(date));
    const interval = setInterval(
      () => setText(formatRelativeTime(date)),
      60_000,
    );
    return () => clearInterval(interval);
  }, [date]);
  // Render empty on server and first client render to avoid hydration mismatch
  return <span>{text}</span>;
}

// ── Status icon ──
const statusIcon: Record<ColumnId, React.ReactNode> = {
  open: <CircleDot className="w-[18px] h-[18px] text-zinc-500" />,
  building: (
    <Loader2 className="w-[18px] h-[18px] text-blue-400 animate-spin" />
  ),
  review: <GitPullRequest className="w-[18px] h-[18px] text-purple-400" />,
  failed: <XCircle className="w-[18px] h-[18px] text-red-400" />,
  "gate-waiting": (
    <AlertTriangle className="w-[18px] h-[18px] text-amber-400" />
  ),
  retrying: <RotateCcw className="w-[18px] h-[18px] text-orange-400" />,
  done: <CheckCircle2 className="w-[18px] h-[18px] text-emerald-400" />,
};

// ── Status label text ──
const statusLabel: Record<ColumnId, string> = {
  open: "Backlog",
  building: "Building",
  review: "In Review",
  failed: "Failed",
  "gate-waiting": "Needs Approval",
  retrying: "Retrying",
  done: "Done",
};

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
  onAssignToKody,
  onUnassignFromKody,
  onUnassign: _onUnassign,
  focusedIndex,
  onOpenPreview,
  onCreateTask,
  onEditTask,
  onDuplicate,
  onHideTask,
  onShowTask,
  onRerun,
  onToggleQueue,
  intakeMode = false,
  collaborators = [],
  draggable,
  onDragStartTask,
  onDragEndTask,
  accent,
}: TaskListProps) {
  const queryClient = useQueryClient();
  const { githubUser } = useGitHubIdentity();
  const { auth } = useAuth();
  const scopedHref = useCallback(
    (href: string) => (auth ? repoScopedHref(auth, href) : href),
    [auth],
  );
  const visibilityMutation = useMutation({
    mutationFn: ({ task, hidden }: { task: KodyTask; hidden: boolean }) =>
      hidden
        ? kodyApi.tasks.addLabel(
            task.issueNumber,
            HIDDEN_TASK_LABEL,
            githubUser?.login,
          )
        : kodyApi.tasks.removeLabel(
            task.issueNumber,
            HIDDEN_TASK_LABEL,
            githubUser?.login,
          ),
    onMutate: async ({ task, hidden }) => {
      await queryClient.cancelQueries({ queryKey: ["kody-tasks"] });
      const previous = queryClient.getQueriesData<KodyTask[]>({
        queryKey: ["kody-tasks"],
      });
      queryClient.setQueriesData<KodyTask[]>(
        { queryKey: ["kody-tasks"] },
        (old) => {
          if (!old) return old;
          return hidden
            ? markTaskHiddenInList(old, task.issueNumber)
            : markTaskVisibleInList(old, task.issueNumber);
        },
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value);
      }
      toast.error("Failed to update task visibility");
    },
    onSuccess: (_data, { task, hidden }) => {
      toast.success(hidden ? "Task hidden from dashboard" : "Task shown");
      queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
      queryClient.invalidateQueries({
        queryKey: ["kody-task", task.issueNumber],
      });
    },
  });
  const closeIssueMutation = useMutation({
    mutationFn: (task: KodyTask) =>
      kodyApi.tasks.closeIssue(task.issueNumber, githubUser?.login),
    onError: (error) => {
      toast.error("Failed to close backlog item", {
        description: error instanceof Error ? error.message : undefined,
      });
    },
    onSuccess: (_data, task) => {
      toast.success("Backlog item closed");
      queryClient.setQueriesData<KodyTask[]>(
        { queryKey: ["kody-tasks"] },
        (old) => old?.filter((t) => t.issueNumber !== task.issueNumber),
      );
      queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
      queryClient.invalidateQueries({
        queryKey: ["kody-task", task.issueNumber],
      });
    },
  });
  const handleHideTask = useCallback(
    (task: KodyTask) => {
      if (onHideTask) onHideTask(task);
      else visibilityMutation.mutate({ task, hidden: true });
    },
    [onHideTask, visibilityMutation],
  );
  const handleShowTask = useCallback(
    (task: KodyTask) => {
      if (onShowTask) onShowTask(task);
      else visibilityMutation.mutate({ task, hidden: false });
    },
    [onShowTask, visibilityMutation],
  );
  const handleCloseBacklogIssue = useCallback(
    (task: KodyTask) => {
      closeIssueMutation.mutate(task);
    },
    [closeIssueMutation],
  );

  const handleTaskClick = useCallback(
    (task: KodyTask) => {
      if (onTaskSelect) {
        onTaskSelect(selectedTask?.id === task.id ? null : task);
      }
    },
    [onTaskSelect, selectedTask],
  );

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] flex items-center justify-center">
          <Inbox className="w-6 h-6 text-muted-foreground/40" />
        </div>
        <div className="space-y-1">
          <p className="text-body-sm font-medium text-foreground">
            No tasks found
          </p>
          <p className="text-body-xs text-muted-foreground">
            Tasks you create or that are assigned to Kody will appear here.
          </p>
        </div>
        {onCreateTask && (
          <Button size="sm" onClick={onCreateTask}>
            + New Task
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("divide-y", accent?.divide ?? "divide-white/[0.06]")}
      role="listbox"
      aria-label="Tasks"
    >
      {tasks.map((task, index) => (
        <TaskRow
          key={task.id}
          task={task}
          isSelected={task.id === selectedTask?.id}
          isFocused={index === focusedIndex}
          isExecuting={executingTaskId === task.id}
          onClick={handleTaskClick}
          onTaskHover={onTaskHover}
          onExecuteTask={onExecuteTask}
          onStopTask={onStopTask}
          onAssign={onAssign}
          onAssignToKody={onAssignToKody}
          onUnassignFromKody={onUnassignFromKody}
          onOpenPreview={onOpenPreview}
          onEditTask={onEditTask}
          onDuplicate={onDuplicate}
          onHideTask={handleHideTask}
          onShowTask={handleShowTask}
          onCloseIssue={handleCloseBacklogIssue}
          onRerun={onRerun}
          onToggleQueue={onToggleQueue}
          intakeMode={intakeMode}
          isClosingIssue={
            closeIssueMutation.isPending &&
            closeIssueMutation.variables?.issueNumber === task.issueNumber
          }
          collaborators={collaborators}
          draggable={draggable}
          onDragStartTask={onDragStartTask}
          onDragEndTask={onDragEndTask}
          accent={accent}
          repoHref={scopedHref}
        />
      ))}
    </div>
  );
}

interface TaskRowProps {
  task: KodyTask;
  isSelected: boolean;
  isFocused: boolean;
  isExecuting: boolean;
  onClick: (task: KodyTask) => void;
  onTaskHover?: (task: KodyTask) => void;
  onExecuteTask?: (task: KodyTask) => void;
  onStopTask?: (task: KodyTask) => void;
  onAssign?: (issueNumber: number, assignees: string[]) => void;
  onAssignToKody?: (task: KodyTask) => void;
  onUnassignFromKody?: (task: KodyTask) => void;
  onOpenPreview?: (task: KodyTask) => void;
  onEditTask?: (task: KodyTask) => void;
  onDuplicate?: (task: KodyTask) => void;
  onHideTask?: (task: KodyTask) => void;
  onShowTask?: (task: KodyTask) => void;
  onCloseIssue?: (task: KodyTask) => void;
  onRerun?: (task: KodyTask) => void;
  onToggleQueue?: (task: KodyTask) => void;
  intakeMode?: boolean;
  isClosingIssue?: boolean;
  collaborators: { login: string; avatar_url: string }[];
  draggable?: boolean;
  onDragStartTask?: (task: KodyTask, event: React.DragEvent) => void;
  onDragEndTask?: (task: KodyTask) => void;
  accent?: { divide: string; rowBg: string; rowHover: string };
  repoHref: (href: string) => string;
}

const TaskRow = memo(function TaskRow({
  task,
  isSelected,
  isFocused,
  isExecuting,
  onClick,
  onTaskHover,
  onExecuteTask,
  onStopTask,
  onAssign,
  onAssignToKody,
  onUnassignFromKody,
  onOpenPreview,
  onEditTask,
  onDuplicate,
  onHideTask,
  onShowTask,
  onCloseIssue,
  onRerun,
  onToggleQueue: _onToggleQueue,
  intakeMode = false,
  isClosingIssue = false,
  collaborators,
  draggable,
  onDragStartTask,
  onDragEndTask,
  accent,
  repoHref,
}: TaskRowProps) {
  const [confirmCloseIssue, setConfirmCloseIssue] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const isClosed = task.state === "closed";
  const isAssignedBacklogTask = task.labels.includes(KODY_BACKLOG_LABEL);
  const isBacklogIntakeTask = intakeMode && !isClosed && task.column === "open";
  const canToggleKodyBacklog =
    isBacklogIntakeTask &&
    (isAssignedBacklogTask ? !!onUnassignFromKody : !!onAssignToKody);
  const taskTitleDirectionProps = textDirectionProps(task.title);
  // Closed tasks come from the "Show closed" toggle (loaded on-demand). They
  // shouldn't offer execute/run actions, and they get a distinct slate
  // palette + "Closed" word so users can tell them apart from in-flight
  // `done`-column tasks at a glance.
  const canExecute = !isClosed && task.column === "open" && onExecuteTask;
  const canStop = isTaskAbortable(task) && !!onStopTask;
  const canRerun =
    !isTaskAbortable(task) &&
    task.column !== "open" &&
    hasTaskRunHistory(task) &&
    !!onRerun;
  const canOverflowRerun =
    !isClosed &&
    !isTaskAbortable(task) &&
    task.column !== "open" &&
    !!onRerun &&
    !canRerun;
  const hasPR = !!task.associatedPR;
  const isHardStop =
    !isClosed &&
    task.column === "gate-waiting" &&
    task.gateType === "hard-stop";
  // gate-waiting tasks also show pipeline progress (they're paused mid-pipeline)
  const isActive =
    !isClosed &&
    (task.column === "building" ||
      task.column === "retrying" ||
      task.column === "gate-waiting");
  const canCloseBacklogItem =
    intakeMode &&
    !isClosed &&
    task.state === "open" &&
    task.column === "open" &&
    !!onCloseIssue;
  const colors = isClosed
    ? {
        dot: "bg-slate-500",
        text: "text-slate-400",
        bg: "bg-slate-500/[0.03]",
        border: "border-s-slate-500/40",
      }
    : statusColors[task.column];
  const gateLabel = isClosed
    ? "Closed"
    : task.column === "gate-waiting" && task.gateType === "hard-stop"
      ? "Hard Stop"
      : task.column === "gate-waiting" && task.gateType === "risk-gated"
        ? "Risk Gated"
        : statusLabel[task.column];
  const showGateLabel = task.column !== "done" && !isBacklogIntakeTask;
  const openCloseIssueConfirm = useCallback(() => {
    setActionsMenuOpen(false);
    window.setTimeout(() => setConfirmCloseIssue(true), 0);
  }, []);

  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = "move";
        // Payload — any consumer can read `task-id`
        try {
          e.dataTransfer.setData("text/plain", String(task.issueNumber));
        } catch {
          /* some browsers restrict setData during drag */
        }
        onDragStartTask?.(task, e);
      }}
      onDragEnd={() => {
        if (!draggable) return;
        onDragEndTask?.(task);
      }}
      onClick={() => onClick(task)}
      onMouseEnter={() => onTaskHover?.(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(task);
        }
      }}
      className={cn(
        "group relative cursor-pointer transition-colors duration-100 border-s-2 border-s-transparent",
        // Hover: palette-tinted if provided, otherwise the default neutral hover
        accent?.rowHover ?? "hover:bg-white/[0.04]",
        // Status-driven bg wins when set; otherwise fall back to the
        // palette-tinted neutral row bg (so 'open' rows pick up the goal color)
        colors.bg || accent?.rowBg || "",
        isBacklogIntakeTask &&
          isAssignedBacklogTask &&
          "bg-blue-500/[0.05] border-s-blue-400/70",
        isSelected && cn("bg-white/[0.06] border-s-2", colors.border),
        isFocused && "ring-1 ring-blue-500/40 bg-blue-500/5",
        isHardStop && "ring-1 ring-red-500/30 ring-inset",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status icon */}
        <div className="shrink-0">
          {isClosed ? (
            <CheckCircle2 className="w-[18px] h-[18px] text-slate-500" />
          ) : (
            statusIcon[task.column]
          )}
        </div>

        {/* Content — title + meta */}
        <div
          className={cn(
            "flex-1 min-w-0",
            isClosed && !isSelected
              ? "opacity-55 group-hover:opacity-90 transition-opacity"
              : task.column === "done" &&
                  !isSelected &&
                  "opacity-50 group-hover:opacity-80 transition-opacity",
          )}
        >
          {/* Title row */}
          <div className="flex items-center gap-2.5">
            <h3
              {...taskTitleDirectionProps}
              className={cn(
                "text-[15px] font-medium truncate flex-1 text-start",
                isClosed ? "text-slate-300 line-through" : "text-zinc-100",
              )}
            >
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
                        <AvatarImage
                          src={assignee.avatar_url}
                          alt={assignee.login}
                        />
                        <AvatarFallback className="text-[8px] bg-zinc-800 text-zinc-400">
                          {assignee.login[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </span>
                  </SimpleTooltip>
                ))}
              {task.pipeline?.triggeredByLogin &&
                !task.assignees?.some(
                  (a) => a.login === task.pipeline?.triggeredByLogin,
                ) && (
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
                task.pipeline.issueCreator !==
                  task.pipeline?.triggeredByLogin && (
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

          {/* Meta row — grouped: identity · type · progress · outcomes.
                    gap-x-3 between groups, gap-1.5 within. */}
          {(() => {
            // Labels that are already represented by the flow chip — don't
            // re-print them in the trailing "first other label" slot.
            const FLOW_DERIVED_LABELS = new Set([
              "bug",
              "feature",
              "chore",
              "spec",
            ]);
            const priorityLabel = task.labels.find((l) =>
              l.startsWith("priority:"),
            );
            const priorityLevel = priorityLabel
              ? parsePriorityLabel(priorityLabel)
              : null;
            const priorityMeta = priorityLevel
              ? PRIORITY_META[priorityLevel]
              : null;
            // Phase chip is suppressed when terminal — gate label already
            // says "Done"/"Failed", so the chip just doubles up.
            const phase = task.kodyPhase;
            const showPhaseChip =
              phase && phase !== "done" && phase !== "failed";
            const firstOtherLabel = task.labels.find(
              (l) =>
                !l.startsWith("priority:") &&
                !l.startsWith("kody:") &&
                !l.startsWith("kody-flow:") &&
                !FLOW_DERIVED_LABELS.has(l) &&
                l !== "ui-approved" &&
                l !== "pr-approved",
            );
            const showTypeGroup = !!task.kodyFlow || !!priorityMeta;
            // Progress group always renders (relative time always shows).
            const showOutcomesGroup = !!firstOtherLabel;

            return (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1 text-body-xs text-zinc-500">
                {/* Group A — Identity: issue # · status word · KODY */}
                <div className="inline-flex items-center gap-1.5">
                  <SimpleTooltip content="Open issue in Kody" side="bottom">
                    <a
                      href={repoHref(`/${task.issueNumber}`)}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "font-mono font-semibold hover:underline",
                        colors.text,
                      )}
                    >
                      #{task.issueNumber}
                    </a>
                  </SimpleTooltip>

                  {hasPR && task.associatedPR && (
                    <SimpleTooltip
                      content="Open pull request in Kody"
                      side="bottom"
                    >
                      <a
                        href={repoHref(`/${task.associatedPR.number}`)}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono font-semibold text-purple-400 hover:underline"
                      >
                        #{task.associatedPR.number}
                      </a>
                    </SimpleTooltip>
                  )}

                  {showGateLabel && (
                    <SimpleTooltip
                      content={
                        <StatusTooltipContent
                          column={task.column}
                          gateType={task.gateType}
                        />
                      }
                      side="bottom"
                    >
                      <span
                        className={cn(
                          "font-medium cursor-default",
                          colors.text,
                        )}
                      >
                        {gateLabel}
                      </span>
                    </SimpleTooltip>
                  )}

                  {task.isKodyAssigned && !isAssignedBacklogTask && (
                    <SimpleTooltip
                      content="Assigned to Kody AI agent"
                      side="bottom"
                    >
                      <span className="inline-flex items-center gap-0.5 font-bold text-blue-400 cursor-default">
                        <Bot className="w-3 h-3" />
                        KODY
                      </span>
                    </SimpleTooltip>
                  )}
                </div>

                {/* Group B — Type/priority: flow chip · priority chip */}
                {showTypeGroup && (
                  <div className="inline-flex items-center gap-1.5">
                    <KodyFlowChip flow={task.kodyFlow} compact />
                    {priorityLabel && priorityLevel && priorityMeta && (
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-1 rounded text-label font-bold border",
                          priorityMeta.colorClass,
                        )}
                      >
                        {priorityLevel}
                      </span>
                    )}
                  </div>
                )}

                {/* Group C — Progress: phase chip (non-terminal) ·
                          sub-status · pipeline · time */}
                <div className="inline-flex items-center gap-1.5">
                  {showPhaseChip && <KodyPhaseChip phase={phase} />}

                  {isActive && (
                    <MiniPipelineProgress task={task} variant="inline" />
                  )}

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
                    <SimpleTooltip
                      content={<SubStatusTooltipContent type="error" />}
                      side="bottom"
                    >
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

                  <span className="text-zinc-600">
                    <RelativeTime date={task.updatedAt} />
                  </span>
                </div>

                {/* Group D — Outcomes: other label */}
                {showOutcomesGroup && firstOtherLabel && (
                  <div className="inline-flex items-center gap-1.5">
                    <span className="hidden sm:inline-flex items-center px-2 py-1 rounded bg-zinc-800 text-zinc-400 text-label font-medium truncate max-w-28">
                      {firstOtherLabel}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* PR-related cluster: approvals · PR link · CI · preview.
                    QA "needs-fix" takes the same slot as the UI-approved chip
                    and is mutually exclusive — approving the UI clears it. */}
          {task.labels.includes("kody:needs-fix") ? (
            <SimpleTooltip content="QA flagged unresolved issues" side="bottom">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-500/10 border border-red-500/40 text-red-300 text-label font-semibold cursor-default">
                <AlertTriangle className="w-3 h-3" />
                Needs fix
              </span>
            </SimpleTooltip>
          ) : task.labels.includes("ui-approved") ? (
            <SimpleTooltip content="UI approved from preview" side="bottom">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-label font-semibold cursor-default">
                <CheckCircle2 className="w-3 h-3" />
                UI
              </span>
            </SimpleTooltip>
          ) : null}

          {task.labels.includes("pr-approved") && (
            <SimpleTooltip content="PR approved from preview" side="bottom">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300 text-label font-semibold cursor-default">
                <CheckCircle2 className="w-3 h-3" />
                PR
              </span>
            </SimpleTooltip>
          )}

          {hasPR && (
            <>
              <SimpleTooltip content="Open PR in Kody" side="bottom">
                <a
                  href={repoHref(`/${task.associatedPR!.number}`)}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors text-label font-medium"
                >
                  <GitPullRequest className="w-3 h-3" />
                  PR
                </a>
              </SimpleTooltip>
              <CIStatusBadge prNumber={task.associatedPR!.number} />
              <UIVerifyBadge prLabels={task.associatedPR!.labels} />
            </>
          )}

          {hasPR &&
            onOpenPreview &&
            (task.column === "review" || task.column === "done") && (
              <SimpleTooltip content="Open PR preview" side="bottom">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPreview(task);
                  }}
                  aria-label="Open PR preview"
                  className="h-9 w-9 p-0 text-emerald-400 hover:bg-emerald-500/20"
                >
                  <Eye className="w-4 h-4" />
                </Button>
              </SimpleTooltip>
            )}

          {canToggleKodyBacklog && (
            <SimpleTooltip
              content={
                isAssignedBacklogTask
                  ? "Unassign from Kody backlog"
                  : "Assign to Kody backlog"
              }
              side="bottom"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isAssignedBacklogTask) {
                    onUnassignFromKody?.(task);
                  } else {
                    onAssignToKody?.(task);
                  }
                }}
                aria-label={
                  isAssignedBacklogTask
                    ? "Unassign from Kody backlog"
                    : "Assign to Kody backlog"
                }
                aria-pressed={isAssignedBacklogTask}
                className={cn(
                  "h-9 w-9 p-0",
                  isAssignedBacklogTask
                    ? "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
                    : "text-zinc-400 hover:bg-blue-500/20 hover:text-blue-300",
                )}
              >
                <Bot className="w-4 h-4" />
              </Button>
            </SimpleTooltip>
          )}

          {canStop || canRerun || (canExecute && onExecuteTask) ? (
            <SimpleTooltip
              content={
                canStop
                  ? "Stop running task"
                  : canRerun
                    ? "Rerun task"
                    : intakeMode && !isAssignedBacklogTask
                    ? "Assign and run"
                    : "Run task"
              }
              side="bottom"
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={isExecuting}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canStop) onStopTask?.(task);
                  else if (canRerun) onRerun?.(task);
                  else if (canExecute) onExecuteTask?.(task);
                }}
                aria-label={
                  canStop
                    ? "Stop task"
                    : canRerun
                      ? "Rerun task"
                      : intakeMode && !isAssignedBacklogTask
                      ? "Assign and run task"
                      : "Run task"
                }
                className={cn(
                  "h-9 w-9 p-0 cursor-pointer disabled:opacity-50",
                  canStop
                    ? "text-red-400 hover:bg-red-500/20"
                    : canRerun
                      ? "text-orange-400 hover:bg-orange-500/20"
                    : "text-zinc-400 hover:bg-white/[0.08]",
                )}
              >
                {isExecuting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : canStop ? (
                  <Square className="w-4 h-4" />
                ) : canRerun ? (
                  <RotateCcw className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </Button>
            </SimpleTooltip>
          ) : null}

          {/* Overflow menu for remaining actions */}
          <DropdownMenu
            open={actionsMenuOpen}
            onOpenChange={setActionsMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => e.stopPropagation()}
                aria-label="More actions"
                className="h-9 w-9 p-0 text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06]"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Assign */}
              {onAssign && collaborators.length > 0 && (
                <>
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="flex flex-col items-start gap-1 py-2"
                  >
                    <span className="text-body-xs text-muted-foreground">
                      Assign to
                    </span>
                    <Select
                      onValueChange={(value) => {
                        onAssign(task.issueNumber, [value]);
                      }}
                    >
                      <SelectTrigger className="w-full h-9 text-body-xs">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {collaborators
                          .filter(
                            (c) =>
                              !task.assignees?.some((a) => a.login === c.login),
                          )
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

              {/* Edit task */}
              {onEditTask && (
                <DropdownMenuItem
                  onClick={() => {
                    onEditTask(task);
                  }}
                >
                  <Pencil className="w-4 h-4 me-2" />
                  Edit task
                </DropdownMenuItem>
              )}

              {/* Duplicate */}
              {onDuplicate && (
                <DropdownMenuItem
                  onClick={() => {
                    onDuplicate(task);
                  }}
                >
                  <Copy className="w-4 h-4 me-2" />
                  Duplicate task
                </DropdownMenuItem>
              )}

              {/* Hide / Show in dashboard */}
              {task.labels.includes(HIDDEN_TASK_LABEL)
                ? onShowTask && (
                    <DropdownMenuItem
                      onClick={() => {
                        onShowTask(task);
                      }}
                    >
                      <Eye className="w-4 h-4 me-2" />
                      Show in dashboard
                    </DropdownMenuItem>
                  )
                : onHideTask && (
                    <DropdownMenuItem
                      onClick={() => {
                        onHideTask(task);
                      }}
                    >
                      <EyeOff className="w-4 h-4 me-2" />
                      Hide from dashboard
                    </DropdownMenuItem>
                  )}

              {canCloseBacklogItem && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={isClosingIssue}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openCloseIssueConfirm();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                    }}
                    onSelect={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openCloseIssueConfirm();
                    }}
                    className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                  >
                    {isClosingIssue ? (
                      <Loader2 className="w-4 h-4 me-2 animate-spin" />
                    ) : (
                      <XCircle className="w-4 h-4 me-2" />
                    )}
                    {isClosingIssue ? "Closing..." : "Close backlog item"}
                  </DropdownMenuItem>
                </>
              )}

              {/* Rerun */}
              {canOverflowRerun && (
                <DropdownMenuItem
                  onClick={() => {
                    onRerun?.(task);
                  }}
                >
                  <RotateCcw className="w-4 h-4 me-2" />
                  Rerun
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Animated status bar — shows pipeline progress with smooth animations */}
      {isActive && (
        <div className="pb-3 px-4 ps-[52px] sm:block hidden">
          <AnimatedStatusBar task={task} />
        </div>
      )}

      {/* Non-active states: show compact animated bar for visual status at a glance */}
      {!isActive && task.column !== "open" && (
        <div className="pb-2 px-4 ps-[52px]">
          <AnimatedStatusBar task={task} />
        </div>
      )}
      {confirmCloseIssue && (
        <ConfirmDialog
          open={true}
          title="Close backlog item"
          description={`Close issue #${task.issueNumber} on GitHub?`}
          confirmLabel={isClosingIssue ? "Closing..." : "Close item"}
          variant="destructive"
          onConfirm={() => onCloseIssue?.(task)}
          onClose={() => setConfirmCloseIssue(false)}
        />
      )}
    </div>
  );
});
