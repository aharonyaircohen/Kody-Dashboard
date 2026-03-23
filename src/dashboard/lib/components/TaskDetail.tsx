/**
 * @fileType component
 * @domain kody
 * @pattern task-detail
 * @ai-summary Task detail — v2 with header quick-links, consolidated sidebar, contextual actions, inline pipeline timeline
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatRelativeTime, cn } from "../utils";
import { getGitHubIssueUrl } from "../constants";
import type {
  KodyTask,
  GitHubComment,
  ColumnId,
  KodyPipelineStatus,
} from "../types";
import { ALL_STAGES } from "../constants";
import {
  calculatePipelineProgress,
  stageLabels,
  formatElapsed,
} from "../pipeline-utils";
import { PipelineStatus } from "./PipelineStatus";
import { ConfirmDialog } from "./ConfirmDialog";
import { CommentEditor } from "./CommentEditor";
import { CommentList } from "./CommentList";
import { AssigneePicker, type AssigneeChangeEvent } from "./AssigneePicker";
import { SimpleTooltip } from "./SimpleTooltip";
import { WorkflowRunsPopover } from "./WorkflowRunsPopover";
import { Button } from "@dashboard/ui/button";
import { Badge } from "@dashboard/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import {
  useTaskActions,
  useTaskDetails,
  useRetryWithContext,
  queryKeys,
} from "../hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import {
  GitPullRequest,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Zap,
  ShieldCheck,
  ShieldX,
  RotateCcw,
  Ban,
  Send,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Github,
  Info,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Timer,
  ArrowLeft,
  Eye,
  Pencil,
  Copy,
  ListPlus,
  ListMinus,
} from "lucide-react";

interface TaskDetailProps {
  task: KodyTask | null;
  onClose?: () => void;
  onRefresh?: () => void;
  onOpenPreview?: () => void;
  onEditTask?: (task: KodyTask) => void;
  onDuplicate?: (task: KodyTask) => void;
}

interface FullTaskDetails extends KodyTask {
  assignees: Array<{ login: string; avatar_url: string }>;
  comments: GitHubComment[];
}

// ============ CONSTANTS ============

const columnColors: Record<
  ColumnId,
  {
    bg: string;
    text: string;
    bar: string;
    pill: string;
    wash: string;
    glow: string;
  }
> = {
  open: {
    bg: "bg-zinc-500/10",
    text: "text-zinc-400",
    bar: "bg-gradient-to-r from-zinc-500 to-zinc-400",
    pill: "bg-zinc-500/20 text-zinc-300 ring-1 ring-zinc-400/30",
    wash: "from-zinc-500/20",
    glow: "",
  },
  building: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    bar: "bg-gradient-to-r from-blue-600 to-blue-400",
    pill: "bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/30",
    wash: "from-blue-500/25",
    glow: "shadow-[0_0_20px_rgba(59,130,246,0.3)]",
  },
  review: {
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    bar: "bg-gradient-to-r from-purple-600 to-purple-400",
    pill: "bg-purple-500/20 text-purple-300 ring-1 ring-purple-400/30",
    wash: "from-purple-500/25",
    glow: "shadow-[0_0_20px_rgba(168,85,247,0.3)]",
  },
  failed: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    bar: "bg-gradient-to-r from-red-600 to-red-400",
    pill: "bg-red-500/20 text-red-300 ring-1 ring-red-400/30",
    wash: "from-red-500/25",
    glow: "shadow-[0_0_20px_rgba(239,68,68,0.3)]",
  },
  "gate-waiting": {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    bar: "bg-gradient-to-r from-amber-600 to-amber-400",
    pill: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/30",
    wash: "from-amber-500/25",
    glow: "shadow-[0_0_20px_rgba(245,158,11,0.3)]",
  },
  retrying: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    bar: "bg-gradient-to-r from-orange-600 to-orange-400",
    pill: "bg-orange-500/20 text-orange-300 ring-1 ring-orange-400/30",
    wash: "from-orange-500/25",
    glow: "shadow-[0_0_20px_rgba(249,115,22,0.3)]",
  },
  done: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    bar: "bg-gradient-to-r from-emerald-600 to-emerald-400",
    pill: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30",
    wash: "from-emerald-500/25",
    glow: "shadow-[0_0_20px_rgba(16,185,129,0.3)]",
  },
};

const columnLabels: Record<ColumnId, string> = {
  open: "Backlog",
  building: "Building",
  review: "In Review",
  failed: "Failed",
  "gate-waiting": "Needs Approval",
  retrying: "Retrying",
  done: "Done",
};

// ============ SUB-COMPONENTS ============

// Tab button with optional count badge
function TabButton({
  active,
  onClick,
  label,
  icon: Icon,
  count,
  tabId,
  panelId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ElementType;
  count?: number;
  tabId?: string;
  panelId?: string;
}) {
  return (
    <button
      role="tab"
      id={tabId}
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium transition-all duration-200",
        active
          ? "text-foreground"
          : "text-muted-foreground/70 hover:text-muted-foreground",
      )}
    >
      <Icon className={cn("w-3.5 h-3.5", active && "text-primary")} />
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "ml-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded-full tabular-nums",
            active
              ? "bg-primary/20 text-primary"
              : "bg-white/[0.06] text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
      {/* Active indicator line */}
      {active && (
        <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-primary rounded-full" />
      )}
    </button>
  );
}

// Status badge with pipeline state indicator
function StatusBadge({
  column,
  pipelineState,
}: {
  column: ColumnId;
  pipelineState?: string;
}) {
  const colors = columnColors[column];
  const isRunning = pipelineState === "running";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase",
        colors.pill,
        colors.glow,
      )}
    >
      {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
      {pipelineState === "completed" && <CheckCircle className="w-3 h-3" />}
      {pipelineState === "failed" && <XCircle className="w-3 h-3" />}
      {columnLabels[column]}
    </span>
  );
}

// ── Contextual Primary Action ──
// Returns the ONE most important action for the current state
function getPrimaryAction(
  task: KodyTask,
  fullDetails: FullTaskDetails | null,
  taskActions: ReturnType<typeof useTaskActions>,
  completedActions: Set<string>,
  setCompletedActions: React.Dispatch<React.SetStateAction<Set<string>>>,
): {
  icon: React.ElementType;
  label: string;
  pendingLabel: string;
  onClick: () => void;
  pendingKey: string;
  variant: "blue" | "yellow" | "red" | "green";
} | null {
  // Gate waiting → Approve
  if (task.column === "gate-waiting" && !completedActions.has("approve")) {
    return {
      icon: ShieldCheck,
      label: "Approve Gate",
      pendingLabel: "Approving…",
      onClick: () => {
        setCompletedActions((prev) => new Set([...prev, "approve"]));
        taskActions.approveGate();
      },
      pendingKey: "approve",
      variant: "yellow",
    };
  }
  // Failed → Retry
  if (task.column === "failed") {
    return {
      icon: RotateCcw,
      label: "Retry",
      pendingLabel: "Retrying…",
      onClick: () => taskActions.execute(),
      pendingKey: "execute",
      variant: "red",
    };
  }
  // Open + in backlog → Run Task (not for review/done/building/gate columns)
  if (task.state === "open" && task.column === "open") {
    return {
      icon: Zap,
      label: "Run Task",
      pendingLabel: "Starting…",
      onClick: () => taskActions.execute(),
      pendingKey: "execute",
      variant: "blue",
    };
  }
  return null;
}

// Secondary/overflow actions
function getOverflowActions(
  task: KodyTask,
  taskActions: ReturnType<typeof useTaskActions>,
  completedActions: Set<string>,
  setCompletedActions: React.Dispatch<React.SetStateAction<Set<string>>>,
  onDuplicate?: (task: KodyTask) => void,
): Array<{
  icon: React.ElementType;
  label: string;
  pendingLabel: string;
  onClick: () => void;
  pendingKey: string;
  destructive?: boolean;
  confirmMessage?: string;
}> {
  const actions: Array<{
    icon: React.ElementType;
    label: string;
    pendingLabel: string;
    onClick: () => void;
    pendingKey: string;
    destructive?: boolean;
    confirmMessage?: string;
  }> = [];

  // Stop (if running)
  if (task.pipeline?.state === "running") {
    actions.push({
      icon: Ban,
      label: "Stop",
      pendingLabel: "Stopping…",
      onClick: () => taskActions.abort(),
      pendingKey: "abort",
      destructive: true,
    });
  }

  // Rerun (if has previous run and not currently building)
  if (task.pipeline && task.pipeline.state !== "running") {
    actions.push({
      icon: RotateCcw,
      label: "Rerun",
      pendingLabel: "Rerunning…",
      onClick: () => taskActions.rerun(),
      pendingKey: "rerun",
    });
  }

  // Reject Gate
  if (task.column === "gate-waiting" && !completedActions.has("reject")) {
    actions.push({
      icon: ShieldX,
      label: "Reject Gate",
      pendingLabel: "Rejecting…",
      onClick: () => {
        setCompletedActions((prev) => new Set([...prev, "reject"]));
        taskActions.rejectGate();
      },
      pendingKey: "reject",
      destructive: true,
    });
  }

  // Queue: Add to Queue (only if task has no queue-related labels)
  const queueLabels = ["kody:queued", "kody:queue-active", "kody:queue-failed"];
  const hasQueueLabel = task.labels.some((l) => queueLabels.includes(l));

  if (!hasQueueLabel && task.state === "open") {
    actions.push({
      icon: ListPlus,
      label: "Add to Queue",
      pendingLabel: "Adding…",
      onClick: () => taskActions.addToQueue(),
      pendingKey: "add-to-queue",
    });
  }

  // Queue: Remove from Queue (only if task is queued but not active)
  if (task.labels.includes("kody:queued")) {
    actions.push({
      icon: ListMinus,
      label: "Remove from Queue",
      pendingLabel: "Removing…",
      onClick: () => taskActions.removeFromQueue(),
      pendingKey: "remove-from-queue",
    });
  }

  // Close PR
  if (task.associatedPR && task.associatedPR.state === "open") {
    actions.push({
      icon: XCircle,
      label: "Close PR",
      pendingLabel: "Closing…",
      onClick: () => taskActions.closePR(),
      pendingKey: "close-pr",
      confirmMessage: `Close PR #${task.associatedPR.number}? This will NOT delete the branch.`,
    });
  }

  // Duplicate Task
  if (onDuplicate) {
    actions.push({
      icon: Copy,
      label: "Duplicate Task",
      pendingLabel: "Duplicating…",
      onClick: () => onDuplicate(task),
      pendingKey: "duplicate",
    });
  }

  // Close / Reopen Issue
  actions.push({
    icon: task.state === "open" ? XCircle : RotateCcw,
    label: task.state === "open" ? "Close Issue" : "Reopen Issue",
    pendingLabel: task.state === "open" ? "Closing…" : "Reopening…",
    onClick: () =>
      task.state === "open" ? taskActions.close() : taskActions.reopen(),
    pendingKey: task.state === "open" ? "close" : "reopen",
  });

  // Reset
  if (
    (task.column === "done" || task.column === "failed" || task.associatedPR) &&
    task.state === "open"
  ) {
    actions.push({
      icon: RotateCcw,
      label: "Reset & Re-run",
      pendingLabel: "Resetting…",
      onClick: () => taskActions.reset(),
      pendingKey: "reset",
      confirmMessage:
        "This will delete the branch, close the PR, remove all agent labels, and re-run the pipeline from scratch. Continue?",
    });
  }

  return actions;
}

// Overflow menu component — uses fixed positioning to escape overflow clipping
function OverflowMenu({
  actions,
  isPending,
  pendingAction,
  direction = "down",
}: {
  actions: ReturnType<typeof getOverflowActions>;
  isPending: boolean;
  pendingAction: string | null;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<
    ReturnType<typeof getOverflowActions>[0] | null
  >(null);

  const handleToggle = useCallback(() => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      if (direction === "up") {
        setMenuPos({ top: rect.top, left: rect.right });
      } else {
        setMenuPos({ top: rect.bottom, left: rect.right });
      }
    }
    setOpen((prev) => !prev);
  }, [open, direction]);

  if (actions.length === 0) return null;

  return (
    <>
      <SimpleTooltip content="More actions" side="bottom">
        <Button
          ref={btnRef}
          variant="ghost"
          size="sm"
          className="h-10 w-10 p-0 shrink-0"
          onClick={handleToggle}
        >
          <MoreHorizontal className="w-5 h-5" />
        </Button>
      </SimpleTooltip>
      {open && (
        <>
          {/* Backdrop — fixed to cover entire screen */}
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setOpen(false)}
          />
          {/* Menu — fixed positioning to escape overflow:hidden parents */}
          <div
            className="fixed z-[101] w-52 bg-popover/95 backdrop-blur-xl border border-white/[0.06] rounded-xl shadow-2xl shadow-black/30 py-1.5"
            style={
              menuPos
                ? direction === "up"
                  ? {
                      bottom: window.innerHeight - menuPos.top + 4,
                      right: window.innerWidth - menuPos.left,
                    }
                  : {
                      top: menuPos.top + 4,
                      right: window.innerWidth - menuPos.left,
                    }
                : undefined
            }
          >
            {actions.map((action) => {
              const isActionPending = pendingAction === action.pendingKey;
              const handleClick = () => {
                if (action.confirmMessage) {
                  setConfirmAction(action);
                  setOpen(false);
                  return;
                }
                action.onClick();
                setOpen(false);
              };
              return (
                <button
                  key={action.label}
                  onClick={handleClick}
                  disabled={isPending}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-colors rounded-lg mx-1 w-[calc(100%-8px)]",
                    action.destructive
                      ? "text-red-400 hover:bg-red-500/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                    isPending && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {isActionPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <action.icon className="w-3.5 h-3.5" />
                  )}
                  {isActionPending ? action.pendingLabel : action.label}
                </button>
              );
            })}
          </div>
        </>
      )}
      {confirmAction && (
        <ConfirmDialog
          open={true}
          title={confirmAction.label}
          description={confirmAction.confirmMessage!}
          confirmLabel={confirmAction.label}
          variant={confirmAction.destructive ? "destructive" : "default"}
          onConfirm={() => confirmAction.onClick()}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}

// ── Inline Pipeline Timeline for main content ──
function InlinePipelineTimeline({
  pipeline,
}: {
  pipeline: KodyPipelineStatus;
}) {
  const progress = calculatePipelineProgress(pipeline);
  const isRunning = pipeline.state === "running";
  const isPaused = pipeline.state === "paused";

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/10 bg-white/[0.03]">
      {/* Stage dots */}
      <div className="flex items-center gap-1">
        {ALL_STAGES.map((stage, i) => {
          const isCompleted = i < progress.currentStageIndex;
          const isCurrent = i === progress.currentStageIndex;
          const isPendingStage = i > progress.currentStageIndex;

          const stateLabel = isCompleted
            ? "Completed"
            : isCurrent
              ? isRunning
                ? "Running"
                : isPaused
                  ? "Paused"
                  : "Current"
              : "Pending";

          return (
            <SimpleTooltip
              key={stage}
              content={
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold">
                    {stageLabels[stage] || stage}
                  </p>
                  <p className="text-xs text-muted-foreground">{stateLabel}</p>
                </div>
              }
              side="bottom"
            >
              <div
                className={cn(
                  "rounded-full transition-all duration-300",
                  isCurrent ? "w-2.5 h-2.5" : "w-1.5 h-1.5",
                  isCompleted && "bg-blue-500",
                  isCurrent &&
                    isRunning &&
                    "bg-blue-400 animate-pulse shadow-[0_0_6px_rgba(96,165,250,0.6)]",
                  isCurrent &&
                    isPaused &&
                    "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.5)]",
                  isPendingStage && "bg-zinc-600/40",
                )}
              />
            </SimpleTooltip>
          );
        })}
      </div>

      {/* Label */}
      <span
        className={cn(
          "text-sm font-medium",
          isRunning && "text-blue-400",
          isPaused && "text-yellow-400",
        )}
      >
        {progress.currentStageLabel}
      </span>

      {/* Step counter */}
      <span className="text-xs text-zinc-500 font-mono tabular-nums">
        {progress.stepNumber}/{progress.totalStages}
      </span>

      {/* Elapsed time */}
      {pipeline.startedAt && (
        <span className="text-xs text-zinc-500 font-mono tabular-nums flex items-center gap-0.5 ml-auto">
          <Timer className="w-3 h-3" />
          {formatElapsed(new Date(pipeline.startedAt))}
        </span>
      )}
    </div>
  );
}

// ============ MAIN COMPONENT ============

export function TaskDetail({
  task,
  onClose,
  onRefresh,
  onOpenPreview,
  onEditTask,
  onDuplicate,
}: TaskDetailProps) {
  const { githubUser } = useGitHubIdentity();
  const actorLogin = githubUser?.login;

  const queryClient = useQueryClient();
  const [assigneeOverride, setAssigneeOverride] = useState<Array<{
    login: string;
    avatar_url: string;
  }> | null>(null);

  const {
    data: details,
    refetch,
    isFetching: isDetailsFetching,
  } = useTaskDetails(task?.issueNumber ?? null, actorLogin);
  const [activeTab, setActiveTab] = useState<"description" | "comments">(() => {
    if (typeof window === "undefined") return "description";
    return window.location.pathname.endsWith("/comments")
      ? "comments"
      : "description";
  });
  const [retryContext, setRetryContext] = useState("");
  const [showRetryContext, setShowRetryContext] = useState(false);
  const [showMobileExtra, setShowMobileExtra] = useState(false);
  const [completedActions, setCompletedActions] = useState<Set<string>>(
    new Set(),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    refetch();
    onRefresh?.();
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => setIsRefreshing(false), 600);
  }, [refetch, onRefresh]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, []);

  // Sync tab from URL on browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      // Only handle if we're on a task detail URL
      if (!/\/\d+/.test(path)) return;
      // Don't handle preview URLs — parent manages those
      if (path.includes("/preview")) return;

      setActiveTab(path.endsWith("/comments") ? "comments" : "description");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    setCompletedActions(new Set());
    setShowMobileExtra(false);
    setActiveTab(
      window.location.pathname.endsWith("/comments")
        ? "comments"
        : "description",
    );
  }, [task?.issueNumber]);

  const retryWithContext = useRetryWithContext({
    issueNumber: task?.issueNumber ?? 0,
    actorLogin,
    onSuccess: () => {
      setRetryContext("");
      setShowRetryContext(false);
      onRefresh?.();
      refetch();
    },
  });

  const taskActions = useTaskActions({
    issueNumber: task?.issueNumber ?? 0,
    actorLogin,
    onSuccess: () => {
      onRefresh?.();
      refetch();
    },
  });

  const fullDetails: FullTaskDetails | null = (() => {
    if (!details?.task || !task) return null;
    return {
      ...task,
      assignees: assigneeOverride ?? details.assignees ?? [],
      comments: (details.comments as GitHubComment[]) || [],
    };
  })();

  // Clear optimistic override once server data refreshes
  useEffect(() => {
    if (assigneeOverride && details?.assignees) {
      setAssigneeOverride(null);
    }
  }, [details?.assignees]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] flex items-center justify-center">
            <Info className="w-6 h-6 text-muted-foreground/30" />
          </div>
          <p className="text-sm text-muted-foreground/50">
            Select a task to view details
          </p>
        </div>
      </div>
    );
  }

  const hasDescription = task.body && task.body.trim().length > 0;
  const commentsCount = fullDetails?.comments?.length || 0;
  const showPipelineTimeline =
    task.pipeline &&
    (task.pipeline.state === "running" || task.pipeline.state === "paused") &&
    task.pipeline.currentStage;

  // Contextual actions
  const primaryAction = getPrimaryAction(
    task,
    fullDetails,
    taskActions,
    completedActions,
    setCompletedActions,
  );
  const overflowActions = getOverflowActions(
    task,
    taskActions,
    completedActions,
    setCompletedActions,
    onDuplicate,
  );

  // --- Shared markdown components ---
  const markdownComponents = {
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mb-3 last:mb-0 text-base text-muted-foreground leading-relaxed break-words">
        {children}
      </p>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:underline"
      >
        {children}
      </a>
    ),
    code: ({
      className,
      children,
      ...props
    }: {
      className?: string;
      children?: React.ReactNode;
    }) => {
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code
          className="bg-muted/50 px-1.5 py-0.5 rounded text-sm text-foreground"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="bg-muted/50 p-3 rounded-md text-sm overflow-x-auto my-3 max-w-full">
        {children}
      </pre>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc pl-6 space-y-1 text-base text-muted-foreground my-2">
        {children}
      </ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal pl-6 space-y-1 text-base text-muted-foreground my-2">
        {children}
      </ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li className="text-base text-muted-foreground leading-relaxed break-words">
        {children}
      </li>
    ),
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-xl font-bold text-foreground mt-6 mb-2 first:mt-0 border-b border-border pb-1">
        {children}
      </h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-lg font-bold text-foreground mt-5 mb-2 first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-base font-semibold text-foreground mt-4 mb-1.5">
        {children}
      </h3>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="text-base font-medium text-foreground mt-3 mb-1">
        {children}
      </h4>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-3 border-blue-500/40 pl-4 my-3 text-base italic text-muted-foreground bg-muted/20 py-2 rounded-r-md">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-border my-4" />,
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-3 rounded-md border border-border">
        <table className="text-xs border-collapse w-full">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="bg-muted/40">{children}</thead>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground text-xs">
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="border-b border-border/50 px-3 py-2 text-muted-foreground text-xs">
        {children}
      </td>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic text-muted-foreground">{children}</em>
    ),
  };

  // --- Retry With Context Block ---
  const retryWithContextBlock = task.column === "failed" && (
    <div className="border-t border-orange-500/20 bg-orange-500/5 mt-2">
      <button
        onClick={() => setShowRetryContext(!showRetryContext)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-orange-500/10 transition-colors rounded-b-lg"
      >
        <span className="text-sm font-medium text-orange-400 flex items-center gap-2">
          <RotateCcw className="w-3.5 h-3.5" />
          Retry with Context
        </span>
        {showRetryContext ? (
          <ChevronUp className="w-4 h-4 text-orange-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-orange-400" />
        )}
      </button>
      {showRetryContext && (
        <div className="px-4 pb-3 space-y-2">
          <textarea
            value={retryContext}
            onChange={(e) => setRetryContext(e.target.value)}
            placeholder="Add context for the retry…"
            className="w-full h-20 px-3 py-2 text-base bg-background border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50 placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Posts <code className="text-orange-400">@kody retry</code> +
              context
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
              onClick={() => retryWithContext.mutate(retryContext)}
              disabled={retryWithContext.isPending}
            >
              {retryWithContext.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-1" />
              )}
              {retryWithContext.isPending ? "Retrying…" : "Retry"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  // --- Tab Configuration (improvement #6: conditional tabs with counts) ---
  const tabs = [
    ...(hasDescription
      ? [{ key: "description" as const, label: "Description", icon: FileText }]
      : []),
    {
      key: "comments" as const,
      label: "Comments",
      icon: MessageSquare,
      count: commentsCount,
    },
  ];

  // Compute effective tab: if current tab was removed (e.g. no PR → no Changes/Docs), fallback
  const validKeys = tabs.map((t) => t.key);
  const effectiveTab = validKeys.includes(activeTab)
    ? activeTab
    : validKeys[0] || "comments";

  // --- Tab Bar ---
  const tabBar = (
    <div
      role="tablist"
      className="flex border-b border-white/[0.08] shrink-0 overflow-x-auto bg-black/10"
    >
      {tabs.map(({ key, label, icon, count }) => (
        <TabButton
          key={key}
          active={effectiveTab === key}
          onClick={() => {
            setActiveTab(key);
            if (task) {
              const base = `/${task.issueNumber}`;
              const path = key === "description" ? base : `${base}/${key}`;
              window.history.pushState(null, "", path);
            }
          }}
          label={label}
          icon={icon}
          count={count}
          tabId={`task-tab-${key}`}
          panelId={`task-panel-${key}`}
        />
      ))}
    </div>
  );

  // --- Tab Content ---
  const tabContent = (
    <>
      {effectiveTab === "description" && hasDescription && (
        <div
          role="tabpanel"
          id="task-panel-description"
          aria-labelledby="task-tab-description"
          className="p-5 md:p-6 overflow-y-auto overflow-x-hidden h-full bg-white/[0.03]"
        >
          <div className="max-w-3xl min-w-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {task.body!}
            </ReactMarkdown>
          </div>
        </div>
      )}
      {effectiveTab === "comments" && (
        <div
          role="tabpanel"
          id="task-panel-comments"
          aria-labelledby="task-tab-comments"
          className="flex flex-col h-full"
        >
          <div className="flex-1 overflow-y-auto p-4 bg-white/[0.03]">
            <CommentList
              comments={fullDetails?.comments || []}
              loading={isDetailsFetching}
            />
          </div>
          <div className="shrink-0 border-t border-white/[0.08] p-3 bg-white/[0.05]">
            <CommentEditor
              issueNumber={task.issueNumber}
              onCommentPosted={() => refetch()}
            />
          </div>
          {retryWithContextBlock}
        </div>
      )}
    </>
  );

  // --- Assignee handler (shared between desktop & mobile) ---
  const handleAssigneeChange = (event: AssigneeChangeEvent) => {
    const current = fullDetails?.assignees || [];
    if (event.action === "assign") {
      setAssigneeOverride([
        ...current,
        { login: event.login, avatar_url: event.avatar_url },
      ]);
    } else {
      setAssigneeOverride(current.filter((a) => a.login !== event.login));
    }
    queryClient.invalidateQueries({
      queryKey: queryKeys.taskDetails(task.issueNumber),
    });
    // Task list refreshes via polling — no need to invalidate here
  };

  // Primary action button colors
  const primaryVariantStyles = {
    blue: "bg-blue-500/20 text-blue-300 border-blue-400/30 hover:bg-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.2)]",
    yellow:
      "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.08)]",
    red: "bg-red-500/20 text-red-300 border-red-400/30 hover:bg-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.2)]",
    green:
      "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.08)]",
  };

  // --- Quick links shared between mobile (expandable) and desktop (header row 3) ---
  const quickLinks = (
    <>
      <a
        href={getGitHubIssueUrl(task.issueNumber)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/[0.08] text-zinc-300 hover:bg-white/[0.12] hover:text-white transition-all duration-150 shrink-0 border border-white/[0.1]"
      >
        <Github className="w-3 h-3" />#{task.issueNumber}
      </a>
      {task.associatedPR && (
        <a
          href={task.associatedPR.html_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 hover:text-purple-200 transition-all duration-150 shrink-0 border border-purple-500/20"
        >
          <GitPullRequest className="w-3 h-3" />
          PR #{task.associatedPR.number}
        </a>
      )}
      {task.workflowRun && (
        <WorkflowRunsPopover
          taskTitle={task.title}
          fallbackRun={task.workflowRun}
        />
      )}
      {task.associatedPR && onOpenPreview && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenPreview();
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 transition-all duration-150 shrink-0 border border-emerald-500/20 cursor-pointer"
        >
          <Eye className="w-3 h-3" />
          Preview
        </button>
      )}
    </>
  );

  // --- Sub-status badges shared ---
  const subStatusBadges =
    task.column === "gate-waiting" ||
    task.isTimeout ||
    task.isExhausted ||
    task.isSupervisorError ||
    task.clarifyWaiting ? (
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {task.column === "gate-waiting" && task.gateType === "hard-stop" && (
          <Badge variant="destructive" className="text-xs px-2 py-0.5">
            <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> HARD STOP
          </Badge>
        )}
        {task.isTimeout && (
          <Badge
            variant="outline"
            className="border-orange-500/50 text-orange-400 text-xs px-2 py-0.5"
          >
            ⏰ TIMEOUT
          </Badge>
        )}
        {task.isExhausted && (
          <Badge
            variant="outline"
            className="border-orange-500/50 text-orange-400 text-xs px-2 py-0.5"
          >
            EXHAUSTED
          </Badge>
        )}
        {task.isSupervisorError && (
          <Badge variant="destructive" className="text-xs px-2 py-0.5">
            ERROR
          </Badge>
        )}
        {task.clarifyWaiting && (
          <Badge
            variant="outline"
            className="border-blue-500/50 text-blue-400 text-xs px-2 py-0.5"
          >
            💬 NEEDS ANSWER
          </Badge>
        )}
      </div>
    ) : null;

  // --- Mobile Header: app-style with back button ---
  const mobileHeader = (
    <div className="md:hidden shrink-0">
      {/* Accent line */}
      <div className={cn("h-1", columnColors[task.column].bar)} />

      {/* Header area */}
      <div
        className={cn(
          "px-3 pt-2.5 pb-3 border-b border-white/[0.08] bg-black/20 bg-gradient-to-b via-50% to-transparent",
          columnColors[task.column].wash,
        )}
      >
        {/* Row 1: ← Back | Status pill | time | Refresh */}
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Back to task list"
            className="h-9 w-9 p-0 -ml-1 shrink-0 text-muted-foreground/60"
          >
            <ArrowLeft className="w-4.5 h-4.5" />
          </Button>

          <StatusBadge
            column={task.column}
            pipelineState={task.pipeline?.state}
          />

          <span className="text-xs text-muted-foreground/50 flex items-center gap-1 ml-auto">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(task.updatedAt)}
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh task"
            className="h-9 w-9 p-0 shrink-0 text-muted-foreground/50"
          >
            <RefreshCw
              className={cn(
                "w-4 h-4 transition-transform",
                isRefreshing && "animate-spin text-blue-400",
              )}
            />
          </Button>
        </div>

        {/* Row 2: Title */}
        <h2 className="text-base font-bold text-white leading-snug tracking-tight pl-1">
          {task.title}
        </h2>

        {/* Sub-status badges */}
        {subStatusBadges && (
          <div className="pl-1 mt-1.5">{subStatusBadges}</div>
        )}
      </div>
    </div>
  );

  // --- Desktop Header: full multi-row layout ---
  const desktopHeader = (
    <div className="hidden md:block shrink-0">
      {/* Accent line */}
      <div className={cn("h-1", columnColors[task.column].bar)} />

      {/* Header — elevated surface */}
      <div
        className={cn(
          "px-6 pt-5 pb-4 border-b border-white/[0.08] bg-black/20 bg-gradient-to-b via-50% to-transparent",
          columnColors[task.column].wash,
        )}
      >
        {/* Row 1: Status pill + time (left) | Actions (right) */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <StatusBadge
              column={task.column}
              pipelineState={task.pipeline?.state}
            />
            <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(task.updatedAt)}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Contextual primary action */}
            {primaryAction && (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-7 gap-1.5 text-xs font-medium rounded-lg",
                  primaryVariantStyles[primaryAction.variant],
                )}
                onClick={primaryAction.onClick}
                disabled={taskActions.isPending}
              >
                {taskActions.pendingAction === primaryAction.pendingKey ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <primaryAction.icon className="w-3 h-3" />
                )}
                <span>
                  {taskActions.pendingAction === primaryAction.pendingKey
                    ? primaryAction.pendingLabel
                    : primaryAction.label}
                </span>
              </Button>
            )}

            {/* Overflow menu */}
            <OverflowMenu
              actions={overflowActions}
              isPending={taskActions.isPending}
              pendingAction={taskActions.pendingAction}
            />

            <span className="w-px h-5 bg-white/[0.06] mx-0.5" />

            {/* Edit button — only for backlog items */}
            {onEditTask && task && task.column === "open" && (
              <SimpleTooltip content="Edit task" side="bottom">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditTask(task)}
                  aria-label="Edit task"
                  className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-muted-foreground"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </SimpleTooltip>
            )}

            <SimpleTooltip content="Refresh" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                aria-label="Refresh task"
                className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-muted-foreground"
              >
                <RefreshCw
                  className={cn(
                    "w-3.5 h-3.5 transition-transform",
                    isRefreshing && "animate-spin text-blue-400",
                  )}
                />
              </Button>
            </SimpleTooltip>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close task detail"
              className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-muted-foreground"
            >
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Row 2: Title — prominent */}
        <h2 className="text-xl font-bold text-white leading-tight tracking-tight mb-3">
          {task.title}
        </h2>

        {/* Row 3: Quick link pills */}
        <div className="flex items-center gap-1.5 flex-wrap">{quickLinks}</div>

        {/* Sub-status badges */}
        {subStatusBadges}
      </div>
    </div>
  );

  // Combined header
  const header = (
    <>
      {mobileHeader}
      {desktopHeader}
    </>
  );

  // --- Desktop Layout: sidebar with card styling ---
  const desktopLayout = (
    <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
      {/* Left sidebar — refined, integrated */}
      <div className="w-56 shrink-0 border-r border-white/[0.08] overflow-y-auto bg-black/20">
        <div className="p-4 space-y-5">
          {/* Assignees section */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
              Assignees
            </h4>
            <div className="rounded-lg p-3 bg-white/[0.03] border border-white/[0.06]">
              <AssigneePicker
                issueNumber={task.issueNumber}
                currentAssignees={fullDetails?.assignees || []}
                onChange={handleAssigneeChange}
              />
            </div>
          </div>

          {/* Priority */}
          {task.labels
            .filter((l) => l.startsWith("priority:"))
            .map((priorityLabel) => {
              const priority = priorityLabel.replace("priority:", "");
              const colors: Record<
                string,
                { bg: string; text: string; border: string }
              > = {
                P0: {
                  bg: "bg-red-500/20",
                  text: "text-red-400",
                  border: "border-red-500/30",
                },
                P1: {
                  bg: "bg-orange-500/20",
                  text: "text-orange-400",
                  border: "border-orange-500/30",
                },
                P2: {
                  bg: "bg-blue-500/20",
                  text: "text-blue-400",
                  border: "border-blue-500/30",
                },
                P3: {
                  bg: "bg-zinc-500/20",
                  text: "text-zinc-400",
                  border: "border-zinc-500/30",
                },
              };
              const c = colors[priority] || colors.P3;
              return (
                <div key={priorityLabel} className="space-y-2">
                  <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                    Priority
                  </h4>
                  <div className="flex flex-wrap gap-1 px-0.5">
                    <span
                      className={cn(
                        "inline-flex px-2.5 py-1 text-xs font-bold rounded-md border",
                        c.bg,
                        c.text,
                        c.border,
                      )}
                    >
                      {priority}
                    </span>
                  </div>
                </div>
              );
            })}

          {/* Labels */}
          {task.labels.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                Labels
              </h4>
              <div className="flex flex-wrap gap-1 px-0.5">
                {task.labels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded-md bg-white/[0.08] text-zinc-300 border border-white/[0.1]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pipeline — refined card */}
          {task.pipeline && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                Pipeline
              </h4>
              <div className="rounded-lg p-3 bg-white/[0.03] border border-white/[0.06]">
                <PipelineStatus status={task.pipeline} />
              </div>
            </div>
          )}

          {/* Triggered by */}
          {task.pipeline?.triggeredByLogin && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                Triggered by
              </h4>
              <div className="flex items-center gap-2 px-0.5">
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarImage
                    src={`https://github.com/${task.pipeline.triggeredByLogin}.png?size=40`}
                    alt={task.pipeline.triggeredByLogin}
                  />
                  <AvatarFallback className="text-[9px]">
                    {task.pipeline.triggeredByLogin[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-foreground">
                  @{task.pipeline.triggeredByLogin}
                </span>
              </div>
            </div>
          )}

          {/* Issue Owner */}
          {task.pipeline?.issueCreator && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                Issue Owner
              </h4>
              <div className="flex items-center gap-2 px-0.5">
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarImage
                    src={`https://github.com/${task.pipeline.issueCreator}.png?size=40`}
                    alt={task.pipeline.issueCreator}
                  />
                  <AvatarFallback className="text-[9px]">
                    {task.pipeline.issueCreator[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-foreground">
                  @{task.pipeline.issueCreator}
                </span>
              </div>
            </div>
          )}

          {/* Actor History */}
          {task.pipeline?.actorHistory &&
            task.pipeline.actorHistory.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                  Activity
                </h4>
                <div className="space-y-2">
                  {task.pipeline.actorHistory.slice(-8).map((event, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Avatar className="h-4 w-4 shrink-0 mt-0.5">
                        <AvatarImage
                          src={`https://github.com/${event.actor}.png?size=32`}
                          alt={event.actor}
                        />
                        <AvatarFallback className="text-[8px]">
                          {event.actor[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-[11px] text-foreground leading-tight">
                          <span className="font-medium">@{event.actor}</span>{" "}
                          <span className="text-muted-foreground">
                            {event.action === "pipeline-triggered"
                              ? "triggered"
                              : event.action === "gate-approved"
                                ? `approved ${event.stage ?? ""} gate`
                                : event.action === "gate-rejected"
                                  ? `rejected ${event.stage ?? ""} gate`
                                  : event.action.replace(/-/g, " ")}
                          </span>
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {formatRelativeTime(event.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Inline pipeline timeline above tabs */}
        {showPipelineTimeline && (
          <InlinePipelineTimeline pipeline={task.pipeline!} />
        )}
        {tabBar}
        <div className="flex-1 min-h-0 overflow-hidden">{tabContent}</div>
      </div>
    </div>
  );

  // --- Mobile Layout: clean with full-width bottom toolbar ---
  const mobileLayout = (
    <div className="md:hidden flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Mobile details panel — expandable */}
      <div className="shrink-0 border-b border-white/10">
        <button
          onClick={() => setShowMobileExtra(!showMobileExtra)}
          className="flex items-center justify-between w-full px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors active:bg-muted/50"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Assignee avatars inline */}
            {fullDetails?.assignees && fullDetails.assignees.length > 0 ? (
              <div className="flex items-center -space-x-1.5 shrink-0">
                {fullDetails.assignees.map((assignee) => (
                  <SimpleTooltip
                    key={assignee.login}
                    content={assignee.login}
                    side="bottom"
                  >
                    <Avatar className="h-6 w-6 ring-2 ring-background">
                      <AvatarImage
                        src={assignee.avatar_url}
                        alt={assignee.login}
                      />
                      <AvatarFallback className="text-[9px]">
                        {assignee.login[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </SimpleTooltip>
                ))}
              </div>
            ) : (
              <span className="italic text-muted-foreground/70">
                Unassigned
              </span>
            )}
            <span className="text-muted-foreground/40">·</span>
            <span className="font-medium">Details</span>
          </div>
          {showMobileExtra ? (
            <ChevronUp className="w-4 h-4 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 shrink-0" />
          )}
        </button>

        {showMobileExtra && (
          <div className="px-4 pb-3 space-y-3 border-t border-border/50">
            {/* Quick links */}
            <div className="flex items-center gap-1.5 flex-wrap pt-2.5">
              {quickLinks}
            </div>

            {/* Labels */}
            {task.labels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {task.labels.map((label) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="text-xs font-normal py-0.5"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            )}

            {/* Assignee picker */}
            <AssigneePicker
              issueNumber={task.issueNumber}
              currentAssignees={fullDetails?.assignees || []}
              onChange={handleAssigneeChange}
            />

            {/* Pipeline */}
            {task.pipeline && <PipelineStatus status={task.pipeline} />}
          </div>
        )}
      </div>

      {/* Inline pipeline timeline (mobile) */}
      {showPipelineTimeline && (
        <InlinePipelineTimeline pipeline={task.pipeline!} />
      )}

      {/* Mobile tabs + content */}
      {tabBar}
      <div className="flex-1 min-h-0 overflow-hidden">{tabContent}</div>

      {/* Bottom toolbar — single row, always visible */}
      <div className="shrink-0 border-t border-white/10 bg-card px-3 py-2 flex items-center gap-1.5 overflow-x-auto">
        {/* Primary action */}
        {primaryAction && (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 gap-1.5 text-xs font-medium shrink-0",
              primaryVariantStyles[primaryAction.variant],
            )}
            onClick={primaryAction.onClick}
            disabled={taskActions.isPending}
          >
            {taskActions.pendingAction === primaryAction.pendingKey ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <primaryAction.icon className="w-3.5 h-3.5" />
            )}
            {taskActions.pendingAction === primaryAction.pendingKey
              ? primaryAction.pendingLabel
              : primaryAction.label}
          </Button>
        )}

        {/* Labeled link pills */}
        <a
          href={getGitHubIssueUrl(task.issueNumber)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="h-9 inline-flex items-center gap-1.5 px-3 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
        >
          <Github className="w-3.5 h-3.5" />#{task.issueNumber}
        </a>
        {task.associatedPR && (
          <a
            href={task.associatedPR.html_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="h-9 inline-flex items-center gap-1.5 px-3 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors shrink-0"
          >
            <GitPullRequest className="w-3.5 h-3.5" />
            PR #{task.associatedPR.number}
          </a>
        )}
        {task.associatedPR && onOpenPreview && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenPreview();
            }}
            className="h-9 inline-flex items-center gap-1.5 px-3 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors shrink-0 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
        )}
        {task.previewUrl && (
          <a
            href={task.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="h-9 inline-flex items-center gap-1.5 px-3 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Deploy
          </a>
        )}

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Overflow — opens UPWARD, uses fixed positioning */}
        <OverflowMenu
          actions={overflowActions}
          isPending={taskActions.isPending}
          pendingAction={taskActions.pendingAction}
          direction="up"
        />
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-card overflow-hidden border border-white/[0.06] shadow-xl shadow-black/20">
      {header}
      {desktopLayout}
      {mobileLayout}
    </div>
  );
}
