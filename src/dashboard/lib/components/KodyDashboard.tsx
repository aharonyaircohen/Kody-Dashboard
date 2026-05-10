/**
 * @fileType component
 * @domain kody
 * @pattern kody-dashboard
 * @ai-summary Main dashboard component with responsive layout — Sheet for mobile controls and task detail
 */
"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { KodyTask, SortField } from "../types";
import { filterTasksByView, getViewModeCounts, sortTasks } from "../utils";
import { TaskList } from "./TaskList";
import { GoalGroupedView, useGoalCollapse } from "./GoalGroupedView";
import { CreateGoalDialog, EditGoalDialog } from "./GoalControl";
import { GoalDiscussionDialog } from "./GoalDiscussionDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { useGoals, useDeleteGoal, goalQueryKeys } from "../hooks/useGoals";
import type { Goal } from "../api";

import { CreateTaskDialog } from "./CreateTaskDialog";
import { EditTaskDialog } from "./EditTaskDialog";
import { BugReportDialog } from "./BugReportDialog";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { BranchCleanupDialog } from "./BranchCleanupDialog";
import { PublishButton } from "./PublishButton";
import { KodyChat } from "./KodyChat";
import type { ChatContext } from "../chat-types";
import { KodyStatusBanner } from "./KodyStatusBanner";
import {
  FilterBar,
  ViewToggle,
  DATE_FILTERS,
  STATUS_FILTERS,
  type ViewMode,
} from "./FilterBar";
import { TaskDetail } from "./TaskDetail";
import { PreviewModal } from "./PreviewModal";
import { Button } from "@dashboard/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@dashboard/ui/sheet";
import {
  MessageSquare,
  Bug,
  Menu,
  RefreshCw,
  AlertCircle,
  X as XIcon,
  Sun,
  Moon,
  GitBranch,
  Github,
  Layers,
  FileText,
  Bell,
  KeyRound,
  ChevronsDownUp,
  ChevronsUpDown,
  List,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useKodyTasks, queryKeys, useDefaultBranchCI } from "../hooks";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useBrowserNotifications } from "../hooks/useBrowserNotifications";
import { useNotificationStore } from "../notifications/useNotificationStore";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { useMediaQuery } from "@dashboard/lib/hooks/useMediaQuery";
import {
  RateLimitError,
  NoTokenError,
  SessionExpiredError,
  tasksApi,
  kodyApi,
  redirectToLogin,
} from "../api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorBoundary } from "./ErrorBoundary";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useTheme } from "@dashboard/providers/Theme";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { SimpleTooltip } from "./SimpleTooltip";
import { PRIORITY_LEVELS, PRIORITY_META } from "../constants";

interface KodyDashboardProps {
  initialIssueNumber?: number;
  initialModal?: "new" | "bug" | "chat";
}

export function KodyDashboard({
  initialIssueNumber,
  initialModal,
}: KodyDashboardProps) {
  const initialIssueRef = useRef(initialIssueNumber);
  // Track if initial modal has been handled to prevent re-opening on tasks change
  const initialModalHandledRef = useRef(false);
  // #1: Track selection by issue number, derive task from query data
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(
    null,
  );
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showBugDialog, setShowBugDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<KodyTask | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<KodyTask | null>(null);
  const [showBranchCleanup, setShowBranchCleanup] = useState(false);
  const [dateFilter, setDateFilter] = useState<string>("30d");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("running");
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Goal-first: inline CRUD + attach dialog state
  const [showCreateGoal, setShowCreateGoal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [pendingDeleteGoal, setPendingDeleteGoal] = useState<Goal | null>(null);
  // Goal whose discussion thread is currently open in a modal. Null = closed.
  const [discussingGoal, setDiscussingGoal] = useState<Goal | null>(null);
  // Goal currently being planned (planner chat dialog). Null = closed. The
  // sessionId is regenerated on every open so a fresh thread is shown.
  const [planningGoal, setPlanningGoal] = useState<Goal | null>(null);
  const [plannerSessionId, setPlannerSessionId] = useState<string | null>(null);
  // When set, the CreateTaskDialog pre-applies this goal's label. Null = no scope.
  const [presetGoalForCreate, setPresetGoalForCreate] = useState<Goal | null>(
    null,
  );
  // When set, the BugReportDialog pre-applies this goal's label. Null = no scope.
  const [presetGoalForBug, setPresetGoalForBug] = useState<Goal | null>(null);
  const [sortField, setSortField] = useState<string>("updatedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const CHAT_WIDTH_KEY = "kody.chatPanelWidth";
  const VIEW_MODE_KEY = "kody.taskListViewMode";
  type TaskListLayout = "grouped" | "flat";
  const [taskListLayout, setTaskListLayout] = useState<TaskListLayout>(() => {
    if (typeof window === "undefined") return "grouped";
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    return stored === "flat" ? "flat" : "grouped";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_KEY, taskListLayout);
    }
  }, [taskListLayout]);
  const CHAT_WIDTH_MIN = 320;
  const CHAT_WIDTH_MAX = 1600;
  const CHAT_WIDTH_SSR_FALLBACK = 600;
  const getDefaultChatWidth = useCallback(() => {
    if (typeof window === "undefined") return CHAT_WIDTH_SSR_FALLBACK;
    const half = Math.floor(window.innerWidth / 2);
    return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, half));
  }, []);
  const [chatPanelWidth, setChatPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return CHAT_WIDTH_SSR_FALLBACK;
    const stored = Number(window.localStorage.getItem(CHAT_WIDTH_KEY));
    if (!Number.isFinite(stored) || stored <= 0) {
      const half = Math.floor(window.innerWidth / 2);
      return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, half));
    }
    return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, stored));
  });
  const isResizingChatRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CHAT_WIDTH_KEY, String(chatPanelWidth));
    }
  }, [chatPanelWidth]);

  const startChatResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingChatRef.current = true;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      if (!isResizingChatRef.current) return;
      const nextWidth = ev.clientX;
      const clamped = Math.min(
        CHAT_WIDTH_MAX,
        Math.max(CHAT_WIDTH_MIN, nextWidth),
      );
      setChatPanelWidth(clamped);
    };

    const onUp = () => {
      isResizingChatRef.current = false;
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
  const filterBarRef = useRef<{ focusSearch: () => void } | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(
      () => setDebouncedSearch(value),
      300,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  // md breakpoint = 768px — below this is "mobile"
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Get days from filter
  const filter = DATE_FILTERS.find((f) => f.value === dateFilter);
  const days = filter?.days;

  // Data fetching with TanStack Query (auto-refreshes: 10s when active, 30s when idle)
  const {
    data: tasks = [],
    isLoading,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useKodyTasks({
    days,
    viewMode: viewMode === "queue" ? "running" : viewMode,
    // Pause list polling while a task is open OR a full-screen modal is up
    // (/new, /bug). The modal owns the foreground; background list will
    // refresh on close via invalidation.
    refetchInterval:
      selectedIssueNumber || showCreateDialog || showBugDialog
        ? false
        : "auto",
  });

  // Default-branch CI roll-up — banner uses this as its primary signal so
  // operators can see whether main is green/red before drilling into tasks.
  const { data: mainCi, isFetching: mainCiFetching } = useDefaultBranchCI();

  // Initialize filters from URL params after hydration (prevents server/client mismatch)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("date");
    if (date && DATE_FILTERS.some((f) => f.value === date)) setDateFilter(date);
    const label = params.get("label");
    if (label) setLabelFilter(label);
    const priority = params.get("priority");
    if (priority) setPriorityFilter(priority);
    const status = params.get("status");
    if (status) setStatusFilter(status);
    const view = params.get("view");
    if (view && ["backlog", "queue", "running"].includes(view))
      setViewMode(view as ViewMode);
    const q = params.get("q");
    if (q) {
      setSearchQuery(q);
      setDebouncedSearch(q);
    }
    const sort = params.get("sort");
    if (sort) setSortField(sort);
    const dir = params.get("dir");
    if (dir === "asc" || dir === "desc") setSortDirection(dir);
  }, []);

  const queryClient = useQueryClient();

  // Helper to handle auth errors — redirects to login if session expired
  const handleAuthError = (error: Error) => {
    if (error instanceof SessionExpiredError) {
      redirectToLogin();
      return true;
    }
    return false;
  };

  // #1: Derive selectedTask from query data — always fresh
  const selectedTask = useMemo(
    () =>
      selectedIssueNumber
        ? (tasks.find((t) => t.issueNumber === selectedIssueNumber) ?? null)
        : null,
    [selectedIssueNumber, tasks],
  );

  // GitHub identity — verified via OAuth session cookie
  const { githubUser, connectedRepo, authError, clearGitHubUser } = useGitHubIdentity();

  // Theme toggle
  const { theme, setTheme } = useTheme();

  // Fetch collaborators for assignee picker
  const { data: collaborators = [] } = useQuery({
    queryKey: ["kody-collaborators"],
    queryFn: () => kodyApi.collaborators.list(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Goals — drive the goal-first dashboard grouping
  const { data: goals = [] } = useGoals();
  const deleteGoalMutation = useDeleteGoal(githubUser?.login);

  // Mutations for assign/unassign
  const assignMutation = useMutation({
    mutationFn: ({
      issueNumber,
      assignees,
    }: {
      issueNumber: number;
      assignees: string[];
    }) => kodyApi.tasks.assign(issueNumber, assignees, githubUser?.login),
    onSuccess: () => {
      toast.success("Assigned");
    },
    onError: (error) => {
      if (!handleAuthError(error)) {
        toast.error("Failed to assign");
      }
    },
  });

  const unassignMutation = useMutation({
    mutationFn: ({
      issueNumber,
      assignees,
    }: {
      issueNumber: number;
      assignees: string[];
    }) => kodyApi.tasks.unassign(issueNumber, assignees, githubUser?.login),
    onSuccess: () => {
      toast.success("Unassigned");
    },
    onError: (error) => {
      if (!handleAuthError(error)) {
        toast.error("Failed to unassign");
      }
    },
  });

  // #2: Replace manual try/catch handlers with mutations + optimistic updates
  const executeMutation = useMutation({
    mutationFn: (task: KodyTask) =>
      tasksApi.execute(task.issueNumber, githubUser?.login),
    // #3: Optimistic update — move task to "building" immediately
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks(days) });
      const previous = queryClient.getQueryData<KodyTask[]>(
        queryKeys.tasks(days),
      );
      queryClient.setQueryData<KodyTask[]>(queryKeys.tasks(days), (old) =>
        old?.map((t) =>
          t.id === task.id ? { ...t, column: "building" as const } : t,
        ),
      );
      return { previous };
    },
    onError: (error, _task, context) => {
      if (handleAuthError(error)) return;
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.tasks(days), context.previous);
      }
      toast.error("Failed to start task");
    },
    onSuccess: () => {
      toast.success("Task started");
      // Let polling handle the refresh — don't force an immediate refetch
    },
  });

  const stopMutation = useMutation({
    mutationFn: (task: KodyTask) =>
      tasksApi.abort(task.issueNumber, githubUser?.login),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks(days) });
      const previous = queryClient.getQueryData<KodyTask[]>(
        queryKeys.tasks(days),
      );
      queryClient.setQueryData<KodyTask[]>(queryKeys.tasks(days), (old) =>
        old?.map((t) =>
          t.id === task.id ? { ...t, column: "open" as const } : t,
        ),
      );
      return { previous };
    },
    onError: (error, _task, context) => {
      if (handleAuthError(error)) return;
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.tasks(days), context.previous);
      }
      toast.error("Failed to stop task");
    },
    onSuccess: () => {
      toast.success("Task stopped");
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (task: KodyTask) =>
      tasksApi.approveReview(task, githubUser?.login),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks(days) });
      const previous = queryClient.getQueryData<KodyTask[]>(
        queryKeys.tasks(days),
      );
      queryClient.setQueryData<KodyTask[]>(queryKeys.tasks(days), (old) =>
        old?.map((t) =>
          t.id === task.id ? { ...t, column: "done" as const } : t,
        ),
      );
      return { previous };
    },
    onError: (error, _task, context) => {
      if (handleAuthError(error)) return;
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.tasks(days), context.previous);
      }
      toast.error("Failed to merge PR");
    },
    onSuccess: () => {
      toast.success("PR merged");
      // Return user to the dashboard: close preview modal, deselect task,
      // and refresh the task list (server already closed the issue).
      setShowPreview(false);
      setSelectedIssueNumber(null);
      setShowMobileDetail(false);
      window.history.pushState(null, "", "/");
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks(days) });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: (task: KodyTask) =>
      tasksApi.rerun(task.issueNumber, githubUser?.login),
    onSuccess: () => {
      toast.success("Task rerun");
    },
    onError: () => {
      toast.error("Failed to rerun task");
    },
  });

  // Derive per-task pending state from mutations
  const executingTaskId = executeMutation.isPending
    ? ((executeMutation.variables as KodyTask | undefined)?.id ?? null)
    : stopMutation.isPending
      ? ((stopMutation.variables as KodyTask | undefined)?.id ?? null)
      : null;

  const mergingTaskId = mergeMutation.isPending
    ? ((mergeMutation.variables as KodyTask | undefined)?.id ?? null)
    : null;

  // Handlers now just delegate to mutations
  const handleExecuteTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) executeMutation.mutate(task);
    },
    [tasks, executeMutation],
  );

  const handleStopTask = useCallback(
    (task: KodyTask) => {
      stopMutation.mutate(task);
    },
    [stopMutation],
  );

  const handleMerge = useCallback(
    async (task: KodyTask) => {
      if (!task.associatedPR) return;
      mergeMutation.mutate(task);
    },
    [mergeMutation],
  );

  // #4: Prefetch task details on hover
  const handleTaskHover = useCallback(
    (task: KodyTask) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.taskDetails(task.issueNumber),
        queryFn: async () => {
          // Catch and swallow errors — GitHub API 502s are transient and shouldn't log as errors
          try {
            return await kodyApi.tasks.get(task.issueNumber);
          } catch {
            return undefined;
          }
        },
        staleTime: 60_000, // 60s — don't re-prefetch on rapid hovers
      });
    },
    [queryClient],
  );

  // Notification system
  const notificationStore = useNotificationStore();

  const {
    checkTaskChanges,
    permission: notificationPermission,
    isSupported: notificationsSupported,
    requestPermission,
  } = useBrowserNotifications({ store: notificationStore });

  // Check for task changes when tasks update
  useEffect(() => {
    if (tasks.length > 0) {
      checkTaskChanges(tasks);
      setErrorDismissed(false); // Reset banner dismissal on successful fetch
    }
  }, [tasks, dataUpdatedAt, checkTaskChanges]);

  // Persist filter state in URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (dateFilter !== "30d") params.set("date", dateFilter);
    else params.delete("date");
    if (statusFilter !== "all") params.set("status", statusFilter);
    else params.delete("status");
    if (labelFilter !== "all") params.set("label", labelFilter);
    else params.delete("label");
    if (priorityFilter !== "all") params.set("priority", priorityFilter);
    else params.delete("priority");
    if (viewMode !== "running") params.set("view", viewMode);
    else params.delete("view");
    if (debouncedSearch) params.set("q", debouncedSearch);
    else params.delete("q");
    const search = params.toString();
    const newUrl = window.location.pathname + (search ? `?${search}` : "");
    window.history.replaceState(null, "", newUrl);
  }, [
    dateFilter,
    statusFilter,
    labelFilter,
    priorityFilter,
    viewMode,
    debouncedSearch,
  ]);

  // Get unique labels from tasks (excluding internal/system labels)
  const availableLabels = Array.from(
    new Set(tasks.flatMap((task) => task.labels)),
  )
    .filter(
      (label) =>
        ![
          "agent:done",
          "agent:error",
          "agent:running",
          "wontfix",
          "invalid",
          "duplicate",
          "question",
          "good first issue",
          "help wanted",
          "released",
        ].includes(label),
    )
    .sort();

  // Calculate label counts
  const labelCounts = tasks.reduce(
    (acc, task) => {
      task.labels.forEach((label) => {
        acc[label] = (acc[label] || 0) + 1;
      });
      return acc;
    },
    {} as Record<string, number>,
  );

  // Calculate status counts
  const statusCounts = tasks.reduce(
    (acc, task) => {
      acc[task.column] = (acc[task.column] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const totalCount = tasks.length;

  // View mode counts — backlog = open column, running = everything else
  const { runningCount, backlogCount, queueCount } = getViewModeCounts(tasks);

  // Filter tasks by view mode, then by status and label (combined with AND logic)
  const baseFilteredTasks = filterTasksByView(tasks, {
    viewMode,
    statusFilter,
    labelFilter,
    priorityFilter,
  });
  const searchedTasks = useMemo(() => {
    if (!debouncedSearch.trim()) return baseFilteredTasks;
    const q = debouncedSearch.toLowerCase();
    return baseFilteredTasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || String(t.issueNumber).includes(q),
    );
  }, [baseFilteredTasks, debouncedSearch]);

  // Sort tasks
  const sortedTasks = useMemo(
    () => sortTasks(searchedTasks, sortField as SortField, sortDirection),
    [searchedTasks, sortField, sortDirection],
  );

  const filteredTasks = sortedTasks;

  // Shared goal collapse controller — drives both the section headers and the
  // expand/collapse toggle that lives in the Kody status banner.
  const {
    collapsed: collapsedGoalKeys,
    toggle: toggleGoalCollapsed,
    allCollapsed: allGoalsCollapsed,
    expandAll: expandAllGoals,
    collapseAll: collapseAllGoals,
    hasMultipleGroups: hasMultipleGoalGroups,
  } = useGoalCollapse(goals, filteredTasks);

  // Keyboard shortcuts (after sortedTasks is defined)
  useKeyboardShortcuts({
    isModalOpen:
      showCreateDialog ||
      !!editingTask ||
      showBugDialog ||
      showBranchCleanup ||
      showPreview ||
      showShortcutsHelp ||
      showMobileMenu ||
      showMobileDetail ||
      showMobileChat,
    onNavigateDown: () =>
      setFocusedIndex((i) => Math.min(i + 1, sortedTasks.length - 1)),
    onNavigateUp: () => setFocusedIndex((i) => Math.max(i - 1, 0)),
    onOpenSelected: () => {
      if (sortedTasks[focusedIndex])
        handleTaskSelect(sortedTasks[focusedIndex]);
    },
    onCloseDetail: () => {
      if (selectedTask) handleTaskSelect(null);
      else if (showPreview) setShowPreview(false);
      else if (showShortcutsHelp) setShowShortcutsHelp(false);
    },
    onRefresh: () => refetch(),
    onNewTask: () => setShowCreateDialog(true),
    onEdit: () => {
      if (selectedTask && selectedTask.column === "open")
        setEditingTask(selectedTask);
    },
    onOpenPreview: () => {
      if (selectedTask?.associatedPR) setShowPreview(true);
    },
    onFocusSearch: () => {
      filterBarRef.current?.focusSearch();
    },
    onShowHelp: () => setShowShortcutsHelp(true),
  });

  // Reset focused index when task list changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [
    sortedTasks.length,
    viewMode,
    statusFilter,
    labelFilter,
    priorityFilter,
    debouncedSearch,
  ]);

  // Check for specific errors
  const isRateLimited = error instanceof RateLimitError;
  const isNoToken = error instanceof NoTokenError;
  const isSessionExpired = error instanceof SessionExpiredError;

  // Get retry info from error
  const retryAfter = isRateLimited
    ? (error as RateLimitError).retryAfter
    : null;
  const resetTime = isRateLimited
    ? (error as RateLimitError).resetTime
    : null;

  // Live-tick "X minutes" countdown derived from the GitHub
  // x-ratelimit-reset epoch. Falls back to the static `retryAfter` string
  // (e.g. "45 minutes") that the server snapshotted at error time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRateLimited) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [isRateLimited]);

  const minutesUntilReset = useMemo(() => {
    if (!resetTime) return null;
    const ts = Date.parse(resetTime);
    if (!Number.isFinite(ts)) return null;
    return Math.max(0, Math.ceil((ts - now) / 60_000));
  }, [resetTime, now]);

  const rateLimitCountdown =
    minutesUntilReset !== null
      ? minutesUntilReset === 0
        ? "any moment now"
        : `in ${minutesUntilReset} minute${minutesUntilReset === 1 ? "" : "s"}`
      : retryAfter
        ? `in ${retryAfter}`
        : null;

  const rateLimitResetClock = useMemo(() => {
    if (!resetTime) return null;
    const d = new Date(resetTime);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [resetTime]);

  // Helper: extract issue number from URL pathname
  const getIssueFromUrl = () => {
    const match = window.location.pathname.match(/\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  // Helper: check if URL is a preview URL
  const isPreviewUrl = () => /\/\d+\/preview/.test(window.location.pathname);

  // Helper: detect modal route from URL
  const getModalFromUrl = (): "new" | "bug" | "chat" | null => {
    const path = window.location.pathname;
    if (path === "/new") return "new";
    if (path === "/bug") return "bug";
    if (path === "/chat") return "chat";
    return null;
  };

  // Helper: push base URL (used when closing modals)
  const pushKodyBase = () => window.history.pushState(null, "", "/");

  // Open preview modal with URL sync
  const handleOpenPreview = useCallback((task: KodyTask) => {
    setSelectedIssueNumber(task.issueNumber);
    setShowPreview(true);
    window.history.pushState(null, "", `/${task.issueNumber}/preview`);
  }, []);

  // Close preview modal with URL sync
  const handleClosePreview = useCallback(() => {
    setShowPreview(false);
    if (selectedIssueNumber) {
      window.history.pushState(null, "", `/${selectedIssueNumber}`);
    }
  }, [selectedIssueNumber]);

  // Open/close modal dialogs with URL sync
  const handleOpenCreate = useCallback(() => {
    setPresetGoalForCreate(null);
    setShowCreateDialog(true);
    window.history.pushState(null, "", "/new");
  }, []);

  const handleCloseCreate = useCallback(() => {
    setShowCreateDialog(false);
    setDuplicateSource(null);
    setPresetGoalForCreate(null);
    pushKodyBase();
  }, []);

  const handleCreateInGoal = useCallback((goal: Goal | null) => {
    setPresetGoalForCreate(goal);
    setShowCreateDialog(true);
    window.history.pushState(null, "", "/new");
  }, []);

  // Goal-to-goal DnD: remove all existing goal:* labels, then add the target (if any)
  const handleMoveTask = useCallback(
    async (task: KodyTask, targetGoalId: string | null) => {
      const existingGoalLabels = task.labels.filter((l) =>
        l.startsWith("goal:"),
      );
      const targetLabel = targetGoalId ? `goal:${targetGoalId}` : null;

      // Optimistic: update the tasks cache so the row jumps to the new group immediately
      queryClient.setQueryData<KodyTask[]>(queryKeys.tasks(days), (old) =>
        old?.map((t) => {
          if (t.id !== task.id) return t;
          const nextLabels = t.labels.filter((l) => !l.startsWith("goal:"));
          if (targetLabel) nextLabels.push(targetLabel);
          return { ...t, labels: nextLabels };
        }),
      );

      try {
        // Remove all existing goal:* labels that aren't the target
        await Promise.all(
          existingGoalLabels
            .filter((l) => l !== targetLabel)
            .map((l) =>
              kodyApi.tasks.removeLabel(
                task.issueNumber,
                l,
                githubUser?.login,
              ),
            ),
        );
        // Add the target label (if we have one and the task doesn't already carry it)
        if (targetLabel && !existingGoalLabels.includes(targetLabel)) {
          await kodyApi.tasks.addLabel(
            task.issueNumber,
            targetLabel,
            githubUser?.login,
          );
        }
        toast.success(
          targetGoalId
            ? `Moved to ${goals.find((g) => g.id === targetGoalId)?.name ?? "goal"}`
            : "Moved to Ungrouped",
        );
        refetch();
      } catch (error) {
        toast.error("Failed to move task", {
          description: (error as Error).message,
        });
        refetch();
      }
    },
    [queryClient, days, githubUser?.login, goals, refetch],
  );

  const handleOpenBug = useCallback(() => {
    setPresetGoalForBug(null);
    setShowBugDialog(true);
    window.history.pushState(null, "", "/bug");
  }, []);

  const handleCloseBug = useCallback(() => {
    setShowBugDialog(false);
    setPresetGoalForBug(null);
    pushKodyBase();
  }, []);

  const handleReportBugInGoal = useCallback((goal: Goal | null) => {
    setPresetGoalForBug(goal);
    setShowBugDialog(true);
    window.history.pushState(null, "", "/bug");
  }, []);

  const handleOpenChat = useCallback(() => {
    setShowMobileChat(true);
    window.history.pushState(null, "", "/chat");
  }, []);

  const handleCloseChat = useCallback((open: boolean) => {
    setShowMobileChat(open);
    if (!open) pushKodyBase();
  }, []);

  // Handle task duplication
  const handleDuplicateTask = useCallback(
    (task: KodyTask) => {
      setDuplicateSource(task);
      handleOpenCreate();
    },
    [handleOpenCreate],
  );

  // Task selection — uses pushState for browser history support
  const handleTaskSelect = useCallback(
    (task: KodyTask | null) => {
      if (task) {
        setSelectedIssueNumber(task.issueNumber);
        window.history.pushState(null, "", `/${task.issueNumber}`);
        if (!isDesktop) {
          setShowMobileDetail(true);
        }
      } else {
        setSelectedIssueNumber(null);
        setShowMobileDetail(false);
        window.history.pushState(null, "", "/");
        // Refresh once on close — polling was paused while the modal was open.
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks(days) });
      }
    },
    [isDesktop, queryClient, days],
  );

  // Auto-select task from URL on initial load
  useEffect(() => {
    // Only handle initial modal once to prevent re-opening on tasks change
    if (!initialModalHandledRef.current) {
      initialModalHandledRef.current = true;
      const modal = initialModal || getModalFromUrl();
      if (modal) {
        if (modal === "new") setShowCreateDialog(true);
        else if (modal === "bug") setShowBugDialog(true);
        else if (modal === "chat") setShowMobileChat(true);
        return;
      }
    }

    // Check for preview URL on initial load
    if (isPreviewUrl()) {
      const issueNum = getIssueFromUrl();
      if (issueNum) {
        setSelectedIssueNumber(issueNum);
        setShowPreview(true);
        initialIssueRef.current = undefined;
        return;
      }
    }

    const issueNum = initialIssueRef.current;
    if (!issueNum || selectedIssueNumber) return;
    if (tasks.length === 0) return;

    const match = tasks.find((t) => t.issueNumber === issueNum);
    if (match) {
      setSelectedIssueNumber(match.issueNumber);
      if (!isDesktop) {
        setShowMobileDetail(true);
      }
      initialIssueRef.current = undefined;
    }
  }, [tasks, isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Browser back/forward — listen to popstate and sync selected task
  useEffect(() => {
    const handlePopState = () => {
      // Close all modals first
      setShowCreateDialog(false);
      setShowBugDialog(false);
      setShowMobileChat(false);
      setShowPreview(false);

      // Check for modal routes
      const modal = getModalFromUrl();
      if (modal) {
        if (modal === "new") setShowCreateDialog(true);
        else if (modal === "bug") setShowBugDialog(true);
        else if (modal === "chat") setShowMobileChat(true);
        return;
      }

      if (isPreviewUrl()) {
        const issueNum = getIssueFromUrl();
        if (issueNum) {
          setSelectedIssueNumber(issueNum);
          setShowPreview(true);
        }
        return;
      }

      const issueNum = getIssueFromUrl();
      if (issueNum) {
        const match = tasks.find((t) => t.issueNumber === issueNum);
        if (match) {
          setSelectedIssueNumber(match.issueNumber);
          if (!isDesktop) setShowMobileDetail(true);
        }
      } else {
        setSelectedIssueNumber(null);
        setShowMobileDetail(false);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [tasks, isDesktop]);

  // Mobile filter controls — rendered inside the mobile menu Sheet
  const mobileFilterControls = (
    <>
      {/* View toggle */}
      <ViewToggle
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        runningCount={runningCount}
        backlogCount={backlogCount}
      />
      {/* Date filter */}
      <Select value={dateFilter} onValueChange={setDateFilter}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Filter by date" />
        </SelectTrigger>
        <SelectContent>
          {DATE_FILTERS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Status filter */}
      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTERS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label} (
              {f.value === "all" ? totalCount : statusCounts[f.value] || 0})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Label filter */}
      <Select value={labelFilter} onValueChange={setLabelFilter}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Filter by label" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All ({totalCount})</SelectItem>
          {availableLabels.map((label) => (
            <SelectItem key={label} value={label}>
              {label} ({labelCounts[label] || 0})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Priority filter */}
      <Select value={priorityFilter} onValueChange={setPriorityFilter}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Filter by priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All priorities</SelectItem>
          {PRIORITY_LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {PRIORITY_META[level].badge} {level} —{" "}
              {PRIORITY_META[level].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  // Chat context for the always-mounted KodyChat panel. Priority:
  //   planner (active "Plan with chat" session) > task (selected task) > null.
  // Planner wins so a user opening another task while planning doesn't
  // accidentally drop the planner thread; the X on the planner badge is
  // the explicit exit. selectedTask is still set in state, so leaving
  // planner mode falls back to the task chat without losing position.
  const exitPlanner = useCallback(() => {
    setPlanningGoal(null);
    setPlannerSessionId(null);
  }, []);
  const plannerExistingTasksForChat = useMemo(() => {
    if (!planningGoal) return undefined;
    return filteredTasks
      .filter((t) => t.labels.includes(`goal:${planningGoal.id}`))
      .map((t) => ({
        number: t.issueNumber,
        title: t.title,
        state: t.state,
      }));
  }, [planningGoal, filteredTasks]);
  const chatContext: ChatContext | null =
    planningGoal && plannerSessionId
      ? {
          kind: "goal-planner",
          goal: planningGoal,
          sessionId: plannerSessionId,
          existingTasks: plannerExistingTasksForChat,
          onTasksCreated: () => {
            refetch();
          },
          onExit: exitPlanner,
        }
      : selectedTask
        ? { kind: "task", task: selectedTask }
        : null;

  // Mobile-only button that opens the chat Sheet — used in error takeovers so
  // mobile users can still reach Kody when the dashboard is otherwise blocked.
  const mobileChatEscapeHatch = (
    <Button
      variant="outline"
      onClick={handleOpenChat}
      className="md:hidden mt-2"
    >
      <MessageSquare className="w-4 h-4 mr-2" />
      Chat with Kody
    </Button>
  );

  // Wrap error takeovers in a layout that keeps the chat sidebar mounted
  // so users can still talk to Kody (e.g. ask it to unblock a GitHub rate limit)
  // even when task fetching is broken. On mobile, chat opens via the button
  // in the error content and renders into the Sheet mounted below.
  const renderErrorTakeover = (content: React.ReactNode) => (
    <>
      <div className="flex h-screen bg-background overflow-hidden">
        <div
          className="relative hidden md:block border-r border-border shrink-0"
          style={{ width: `${chatPanelWidth}px` }}
        >
          <KodyChat context={null} actorLogin={githubUser?.login} />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            onMouseDown={startChatResize}
            onDoubleClick={() => setChatPanelWidth(getDefaultChatWidth())}
            className="absolute top-0 right-0 h-full w-1 translate-x-1/2 cursor-col-resize z-20 hover:bg-primary/40 active:bg-primary/60 transition-colors"
            title="Drag to resize • Double-click to reset"
          />
        </div>
        <div className="flex-1 flex items-center justify-center">{content}</div>
      </div>
      {!isDesktop && (
        <Sheet open={showMobileChat} onOpenChange={handleCloseChat}>
          <SheetContent side="right" className="w-full sm:w-[400px] !p-0 !gap-0" hideClose>
            <SheetHeader className="sr-only">
              <SheetTitle>Chat with Kody</SheetTitle>
              <SheetDescription>AI assistant chat</SheetDescription>
            </SheetHeader>
            <KodyChat
              context={null}
              actorLogin={githubUser?.login}
              onClose={() => handleCloseChat(false)}
            />
          </SheetContent>
        </Sheet>
      )}
    </>
  );

  // Session expired — only possible when using OAuth sessions (token-only mode shouldn't reach here)
  if (isSessionExpired) {
    return renderErrorTakeover(
      <div className="text-center max-w-md p-6">
        <div className="text-6xl mb-4">⚠️</div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Authentication Error
        </h2>
        <p className="text-muted-foreground mb-4">
          Your session is invalid. Ensure <code>GITHUB_TOKEN</code> is set in your environment variables.
        </p>
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => refetch()}>Retry</Button>
          {mobileChatEscapeHatch}
        </div>
      </div>
    );
  }

  // No token error — can't function without token, but keep chat available
  if (isNoToken) {
    return renderErrorTakeover(
      <div className="text-center max-w-md p-6">
        <div className="text-6xl mb-4">⚠️</div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Unable to Load Tasks
        </h2>
        <p className="text-muted-foreground mb-4">
          {error?.message ||
            "GitHub token is not configured. Set GITHUB_TOKEN, KODY_BOT_TOKEN, or GH_PAT in environment variables."}
        </p>
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => refetch()}>Retry</Button>
          {mobileChatEscapeHatch}
        </div>
      </div>
    );
  }

  // Auth error from /api/kody/auth/me (token valid but repo access denied)
  if (authError) {
    return renderErrorTakeover(
      <div className="text-center max-w-md p-6">
        <div className="text-6xl mb-4">🔒</div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Authentication Failed
        </h2>
        <p className="text-muted-foreground mb-4">{authError}</p>
        <p className="text-sm text-muted-foreground mb-4">
          Check that your token has access to the repository and try logging in again.
        </p>
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => { localStorage.removeItem('kody_auth'); window.location.href = '/login' }}>
            Log in again
          </Button>
          {mobileChatEscapeHatch}
        </div>
      </div>
    );
  }

  // Rate limit takeover — show live countdown until the GitHub limit refreshes
  if (isRateLimited) {
    return renderErrorTakeover(
      <div className="text-center max-w-md p-6">
        <div className="text-6xl mb-4">🚦</div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          GitHub API rate limit reached
        </h2>
        <p className="text-muted-foreground mb-2">
          {rateLimitCountdown
            ? `Refreshes ${rateLimitCountdown}`
            : "Refresh window unknown"}
          {rateLimitResetClock ? ` (at ${rateLimitResetClock})` : ""}
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          The dashboard shares one GitHub token across all users. Polling will
          resume automatically once the window resets.
        </p>
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => refetch()}>Retry now</Button>
          {mobileChatEscapeHatch}
        </div>
      </div>
    );
  }

  // Generic error fallback (covers non-rate-limit GitHub failures)
  if (error) {
    return renderErrorTakeover(
      <div className="text-center max-w-md p-6">
        <div className="text-6xl mb-4">⚠️</div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Failed to Load Tasks
        </h2>
        <p className="text-muted-foreground mb-4">{error.message}</p>
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => refetch()}>Retry</Button>
          {mobileChatEscapeHatch}
        </div>
      </div>
    );
  }

  // Build an inline error banner message for rate limit / generic errors
  const errorBannerMessage = !errorDismissed
    ? isRateLimited
      ? `GitHub API rate limited${rateLimitCountdown ? ` — refreshes ${rateLimitCountdown}` : ""}${rateLimitResetClock ? ` (at ${rateLimitResetClock})` : ""}`
      : error
        ? (error as Error).message
        : null
    : null;

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Preview Modal — full-screen overlay */}
        {showPreview && selectedTask && (
          <PreviewModal
            task={selectedTask}
            onClose={handleClosePreview}
            onMerge={() => handleMerge(selectedTask)}
            isMerging={!!(mergingTaskId === selectedTask.id)}
          />
        )}
        {/* Desktop: Chat Panel (left side, always visible) */}
        <div
          className="relative hidden md:block border-r border-border shrink-0"
          style={{ width: `${chatPanelWidth}px` }}
        >
          <KodyChat context={chatContext} actorLogin={githubUser?.login} />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            onMouseDown={startChatResize}
            onDoubleClick={() => setChatPanelWidth(getDefaultChatWidth())}
            className="absolute top-0 right-0 h-full w-1 translate-x-1/2 cursor-col-resize z-20 hover:bg-primary/40 active:bg-primary/60 transition-colors"
            title="Drag to resize • Double-click to reset"
          />
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* When a task is selected, TaskDetail takes over the entire left column */}
          {selectedTask ? (
            <TaskDetail
              task={selectedTask}
              onClose={() => handleTaskSelect(null)}
              onRefresh={refetch}
              onOpenPreview={() =>
                selectedTask && handleOpenPreview(selectedTask)
              }
              onEditTask={setEditingTask}
              onDuplicate={handleDuplicateTask}
            />
          ) : (
            <>
              {/* Header — action buttons only, no filters */}
              <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/[0.06] bg-black/20">
                <div className="flex items-baseline gap-2">
                  <h1 className="text-lg md:text-xl font-semibold text-foreground">
                    {connectedRepo?.split('/').pop() || 'Kody Operations'}
                  </h1>
                  {process.env.NEXT_PUBLIC_APP_VERSION ? (
                    <span className="text-xs text-muted-foreground font-mono">
                      v{process.env.NEXT_PUBLIC_APP_VERSION}
                    </span>
                  ) : null}
                </div>

                {/* Desktop controls */}
                <div className="hidden md:flex items-center gap-3">
                  {/* GitHub identity badge with dropdown */}
                  {(githubUser || connectedRepo) && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowUserDropdown((prev) => !prev)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent transition-colors max-w-[180px]"
                      >
                        {githubUser ? (
                          <Avatar className="h-5 w-5 shrink-0">
                            <AvatarImage
                              src={githubUser.avatar_url}
                              alt={githubUser.login}
                            />
                            <AvatarFallback>
                              {githubUser.login[0]?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <Github className="h-3 w-3 text-muted-foreground" />
                          </div>
                        )}
                        <span className="text-xs text-muted-foreground truncate">
                          {githubUser ? `@${githubUser.login}` : 'Connected'}
                          {connectedRepo && (
                            <span className="text-muted-foreground/60"> · {connectedRepo}</span>
                          )}
                        </span>
                      </button>
                      {showUserDropdown && (
                        <div className="absolute top-full right-0 mt-1 w-56 py-1 bg-popover border rounded-md shadow-lg z-50">
                          {connectedRepo && (
                            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b mb-1">
                              <span className="font-medium text-foreground">Repo:</span>{' '}
                              {connectedRepo}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              clearGitHubUser();
                              setShowUserDropdown(false);
                            }}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                          >
                            Sign out
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notification center */}
                  <NotificationCenter
                    store={notificationStore}
                    browserPermission={notificationPermission}
                    isSupported={notificationsSupported}
                    onRequestPermission={requestPermission}
                  />

                  {/* Theme toggle */}
                  <SimpleTooltip
                    content={
                      theme === "dark"
                        ? "Switch to light mode"
                        : "Switch to dark mode"
                    }
                    side="bottom"
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setTheme(theme === "dark" ? "light" : "dark")
                      }
                      aria-label={
                        theme === "dark"
                          ? "Switch to light mode"
                          : "Switch to dark mode"
                      }
                      className="text-muted-foreground"
                    >
                      {theme === "dark" ? (
                        <Sun className="w-4 h-4" />
                      ) : (
                        <Moon className="w-4 h-4" />
                      )}
                    </Button>
                  </SimpleTooltip>

                  {/* Jobs */}
                  <SimpleTooltip content="Jobs" side="bottom">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Link href="/jobs" aria-label="Jobs">
                        <Layers className="w-4 h-4" />
                        Jobs
                      </Link>
                    </Button>
                  </SimpleTooltip>

                  {/* Reports */}
                  <SimpleTooltip content="Reports" side="bottom">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Link href="/reports" aria-label="Reports">
                        <FileText className="w-4 h-4" />
                        Reports
                      </Link>
                    </Button>
                  </SimpleTooltip>

                  {/* Notifications */}
                  <SimpleTooltip content="Notifications" side="bottom">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Link href="/notifications" aria-label="Notifications">
                        <Bell className="w-4 h-4" />
                      </Link>
                    </Button>
                  </SimpleTooltip>

                  {/* Secrets */}
                  <SimpleTooltip content="Secrets" side="bottom">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Link href="/secrets" aria-label="Secrets">
                        <KeyRound className="w-4 h-4" />
                      </Link>
                    </Button>
                  </SimpleTooltip>

                  {/* Repositories */}
                  <SimpleTooltip content="Repositories" side="bottom">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Link href="/repos" aria-label="Repositories">
                        <Github className="w-4 h-4" />
                      </Link>
                    </Button>
                  </SimpleTooltip>

                  {/* Publish a release */}
                  <PublishButton
                    actorLogin={githubUser?.login}
                    onPublished={(n) => setSelectedIssueNumber(n)}
                  />

                  {/* Branch cleanup */}
                  <SimpleTooltip content="Clean up branches" side="bottom">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowBranchCleanup(true)}
                      aria-label="Clean up branches"
                      className="gap-1"
                    >
                      <GitBranch className="w-4 h-4" />
                      Cleanup
                    </Button>
                  </SimpleTooltip>
                  <SimpleTooltip content="Refresh" side="bottom">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        refetch();
                        queryClient.invalidateQueries({ queryKey: goalQueryKeys.list });
                      }}
                      disabled={isFetching}
                      aria-label="Refresh"
                      className="gap-1"
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
                      />
                    </Button>
                  </SimpleTooltip>

                </div>

                {/* Mobile hamburger */}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Open menu"
                  className="md:hidden"
                  onClick={() => setShowMobileMenu(true)}
                >
                  <Menu className="w-5 h-5" />
                </Button>
              </div>

              {/* Filter Sub-header — desktop only, separate component */}
              <div className="hidden md:block">
                <FilterBar
                  ref={filterBarRef}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  dateFilter={dateFilter}
                  onDateFilterChange={setDateFilter}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  labelFilter={labelFilter}
                  onLabelFilterChange={setLabelFilter}
                  priorityFilter={priorityFilter}
                  onPriorityFilterChange={setPriorityFilter}
                  availableLabels={availableLabels}
                  labelCounts={labelCounts}
                  statusCounts={statusCounts}
                  totalCount={totalCount}
                  filteredCount={filteredTasks.length}
                  runningCount={runningCount}
                  backlogCount={backlogCount}
                  queueCount={queueCount}
                  searchQuery={searchQuery}
                  onSearchChange={handleSearchChange}
                  sortField={sortField as SortField}
                  onSortFieldChange={setSortField}
                  sortDirection={sortDirection}
                  onSortDirectionChange={setSortDirection}
                />
              </div>

              {/* Error banner (rate limit / generic errors — dismissible, stale data still shown) */}
              {errorBannerMessage && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{errorBannerMessage}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-red-400 hover:bg-red-500/10 shrink-0"
                    onClick={() => refetch()}
                  >
                    Retry
                  </Button>
                  <button
                    onClick={() => setErrorDismissed(true)}
                    className="text-red-400 hover:text-red-300"
                    aria-label="Dismiss error"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Kody Status Banner */}
              <KodyStatusBanner
                tasks={tasks}
                mainCi={mainCi}
                mainCiLoading={mainCiFetching}
                isFetching={isFetching}
                dataUpdatedAt={dataUpdatedAt}
                trailing={
                  <div className="flex items-center gap-1 shrink-0">
                    {/* View toggle: grouped-by-goal vs. flat task list. The
                        flat view is the legacy layout — useful when the
                        user wants every task in one stream regardless of
                        goal. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setTaskListLayout(
                          taskListLayout === "grouped" ? "flat" : "grouped",
                        )
                      }
                      className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      title={
                        taskListLayout === "grouped"
                          ? "Switch to flat task list (hide goals)"
                          : "Switch to goal-grouped view"
                      }
                    >
                      {taskListLayout === "grouped" ? (
                        <>
                          <List className="w-3.5 h-3.5" />
                          Flat list
                        </>
                      ) : (
                        <>
                          <Layers className="w-3.5 h-3.5" />
                          Group by goal
                        </>
                      )}
                    </Button>
                    {taskListLayout === "grouped" && hasMultipleGoalGroups ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={
                          allGoalsCollapsed ? expandAllGoals : collapseAllGoals
                        }
                        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {allGoalsCollapsed ? (
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
                    ) : null}
                  </div>
                }
              />

              {/* Task List */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                {isLoading && tasks.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-muted-foreground">Loading...</div>
                  </div>
                ) : taskListLayout === "flat" ? (
                  <div>
                    {/* Legacy flat view: actions pinned at the top so the
                        user can create a task or report a bug without
                        scrolling into a goal section. */}
                    <div className="grid gap-2 grid-cols-2 p-3">
                      <button
                        type="button"
                        onClick={handleOpenCreate}
                        className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-white/[0.12] bg-white/[0.02] px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] hover:border-white/[0.18] transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        New task
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReportBugInGoal(null)}
                        className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-white/[0.12] bg-white/[0.02] px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] hover:border-white/[0.18] transition-colors"
                      >
                        <Bug className="w-4 h-4" />
                        Report a bug
                      </button>
                    </div>
                    <TaskList
                      tasks={filteredTasks}
                      selectedTask={selectedTask}
                      executingTaskId={executingTaskId}
                      mergingTaskId={mergingTaskId}
                      focusedIndex={focusedIndex}
                      onTaskSelect={handleTaskSelect}
                      onExecuteTask={handleExecuteTask}
                      onStopTask={handleStopTask}
                      onApproveReview={handleMerge}
                      onTaskHover={handleTaskHover}
                      collaborators={collaborators}
                      onAssign={(issueNumber, assignees) =>
                        assignMutation.mutate({ issueNumber, assignees })
                      }
                      onUnassign={(issueNumber, assignees) =>
                        unassignMutation.mutate({ issueNumber, assignees })
                      }
                      onOpenPreview={handleOpenPreview}
                      onCreateTask={handleOpenCreate}
                      onEditTask={setEditingTask}
                      onDuplicate={handleDuplicateTask}
                      onRerun={(task) => rerunMutation.mutate(task)}
                      onToggleQueue={(task) => {
                        const isQueued = task.labels.includes("kody:queued");
                        const action = isQueued
                          ? tasksApi.removeFromQueue(
                              task.issueNumber,
                              githubUser?.login,
                            )
                          : tasksApi.addToQueue(
                              task.issueNumber,
                              githubUser?.login,
                            );
                        action.then(() => {
                          toast.success(
                            isQueued ? "Removed from queue" : "Added to queue",
                          );
                          refetch();
                        });
                      }}
                    />
                  </div>
                ) : (
                  <GoalGroupedView
                    collapsed={collapsedGoalKeys}
                    onToggleCollapsed={toggleGoalCollapsed}
                    goals={goals}
                    tasks={filteredTasks}
                    selectedTask={selectedTask}
                    executingTaskId={executingTaskId}
                    mergingTaskId={mergingTaskId}
                    focusedIndex={focusedIndex}
                    onTaskSelect={handleTaskSelect}
                    onExecuteTask={handleExecuteTask}
                    onStopTask={handleStopTask}
                    onApproveReview={handleMerge}
                    onTaskHover={handleTaskHover}
                    collaborators={collaborators}
                    onAssign={(issueNumber, assignees) =>
                      assignMutation.mutate({ issueNumber, assignees })
                    }
                    onUnassign={(issueNumber, assignees) =>
                      unassignMutation.mutate({ issueNumber, assignees })
                    }
                    onOpenPreview={handleOpenPreview}
                    onCreateTask={handleOpenCreate}
                    onEditTask={setEditingTask}
                    onDuplicate={handleDuplicateTask}
                    onRerun={(task) => rerunMutation.mutate(task)}
                    onToggleQueue={(task) => {
                      const isQueued = task.labels.includes("kody:queued");
                      const action = isQueued
                        ? tasksApi.removeFromQueue(
                            task.issueNumber,
                            githubUser?.login,
                          )
                        : tasksApi.addToQueue(
                            task.issueNumber,
                            githubUser?.login,
                          );
                      action.then(() => {
                        toast.success(
                          isQueued ? "Removed from queue" : "Added to queue",
                        );
                        refetch();
                      });
                    }}
                    onCreateGoal={() => setShowCreateGoal(true)}
                    onEditGoal={setEditingGoal}
                    onDeleteGoal={setPendingDeleteGoal}
                    onOpenGoalDiscussion={setDiscussingGoal}
                    onPlanGoal={(goal) => {
                      // Generate a fresh planner session id (so messages
                      // start clean) and switch the chat panel into
                      // goal-planner mode. The X on the chat header
                      // exits planner mode and returns to task/global.
                      setPlannerSessionId(
                        typeof crypto !== "undefined" && "randomUUID" in crypto
                          ? crypto.randomUUID()
                          : `planner-${Date.now()}`,
                      );
                      setPlanningGoal(goal);
                      // On mobile, surface the chat sheet so the user
                      // sees the planner kick off — on desktop the panel
                      // is always visible.
                      if (!isDesktop) handleOpenChat();
                    }}
                    onCreateTaskInGoal={handleCreateInGoal}
                    onReportBugInGoal={handleReportBugInGoal}
                    onMoveTask={handleMoveTask}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* Mobile Menu Sheet */}
        <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
          <SheetContent side="right" className="w-[88vw] sm:w-[360px] !p-0 !gap-0 overflow-y-auto">
            <SheetHeader className="px-4 pt-4 pb-2">
              <SheetTitle>Menu</SheetTitle>
              <SheetDescription className="sr-only">
                Dashboard controls and filters
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-3 px-4 pb-6">
              {/* GitHub identity */}
              {githubUser && (
                <button
                  type="button"
                  onClick={() => {
                    clearGitHubUser();
                    setShowMobileMenu(false);
                  }}
                  className="flex items-center gap-2 px-2 py-3 rounded-md hover:bg-accent transition-colors border border-border"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarImage
                      src={githubUser.avatar_url}
                      alt={githubUser.login}
                    />
                    <AvatarFallback>
                      {githubUser.login[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-medium">
                      @{githubUser.login}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Tap to sign out
                    </span>
                  </div>
                </button>
              )}

              {/* Primary */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => {
                    setShowMobileMenu(false);
                    handleOpenChat();
                  }}
                >
                  <MessageSquare className="w-4 h-4" />
                  Chat with Kody
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => setShowMobileMenu(false)}
                >
                  <Link href="/jobs">
                    <Layers className="w-4 h-4" />
                    Jobs
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => setShowMobileMenu(false)}
                >
                  <Link href="/reports">
                    <FileText className="w-4 h-4" />
                    Reports
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => setShowMobileMenu(false)}
                >
                  <Link href="/notifications">
                    <Bell className="w-4 h-4" />
                    Notifications
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => setShowMobileMenu(false)}
                >
                  <Link href="/secrets">
                    <KeyRound className="w-4 h-4" />
                    Secrets
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => setShowMobileMenu(false)}
                >
                  <Link href="/repos">
                    <Github className="w-4 h-4" />
                    Repositories
                  </Link>
                </Button>
              </div>

              {/* Filters */}
              <div className="space-y-2 pt-2 border-t border-border">
                <span className="text-xs font-medium text-muted-foreground uppercase">
                  Filters
                </span>
                {mobileFilterControls}
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-2 border-t border-border">
                <span className="text-xs font-medium text-muted-foreground uppercase">
                  Actions
                </span>
                <div onClick={() => setShowMobileMenu(false)}>
                  <PublishButton
                    actorLogin={githubUser?.login}
                    onPublished={(n) => setSelectedIssueNumber(n)}
                    triggerClassName="w-full justify-start gap-2 h-11"
                  />
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => {
                    setShowMobileMenu(false);
                    setShowBranchCleanup(true);
                  }}
                >
                  <GitBranch className="w-4 h-4" />
                  Cleanup branches
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => {
                    refetch();
                    queryClient.invalidateQueries({ queryKey: goalQueryKeys.list });
                  }}
                  disabled={isFetching}
                >
                  <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  {theme === "dark" ? (
                    <Sun className="w-4 h-4" />
                  ) : (
                    <Moon className="w-4 h-4" />
                  )}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-11"
                  onClick={() => {
                    setShowMobileMenu(false);
                    handleOpenBug();
                  }}
                >
                  <Bug className="w-4 h-4" />
                  Report Bug
                </Button>
                <Button
                  className="w-full h-11"
                  onClick={() => {
                    setShowMobileMenu(false);
                    handleOpenCreate();
                  }}
                >
                  + New Task
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Mobile Task Detail Sheet — only rendered on mobile */}
        {!isDesktop && (
          <Sheet
            open={showMobileDetail && !!selectedTask}
            onOpenChange={(open) => {
              if (!open) {
                handleTaskSelect(null);
              }
            }}
          >
            <SheetContent
              side="right"
              className="w-full sm:w-[400px] !p-0 !gap-0"
              hideClose
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Task Details</SheetTitle>
                <SheetDescription>
                  View and manage task details
                </SheetDescription>
              </SheetHeader>
              <TaskDetail
                task={selectedTask}
                onClose={() => handleTaskSelect(null)}
                onRefresh={refetch}
                onEditTask={setEditingTask}
                onDuplicate={handleDuplicateTask}
              />
            </SheetContent>
          </Sheet>
        )}

        {/* Mobile Chat Sheet — only rendered on mobile */}
        {!isDesktop && (
          <Sheet open={showMobileChat} onOpenChange={handleCloseChat}>
            <SheetContent side="right" className="w-full sm:w-[400px] !p-0 !gap-0" hideClose>
              <SheetHeader className="sr-only">
                <SheetTitle>Chat with Kody</SheetTitle>
                <SheetDescription>AI assistant chat</SheetDescription>
              </SheetHeader>
              <KodyChat
                context={chatContext}
                actorLogin={githubUser?.login}
                onClose={() => handleCloseChat(false)}
              />
            </SheetContent>
          </Sheet>
        )}

        {/* Create Dialog */}
        <CreateTaskDialog
          open={showCreateDialog}
          onClose={handleCloseCreate}
          onCreated={refetch}
          initialData={
            duplicateSource
              ? {
                  title: duplicateSource.title,
                  body: duplicateSource.body,
                  labels: duplicateSource.labels,
                  assignees: duplicateSource.assignees?.map((a) => a.login),
                }
              : undefined
          }
          presetLabels={
            presetGoalForCreate
              ? [`goal:${presetGoalForCreate.id}`]
              : undefined
          }
        />

        {/* Edit Task Dialog */}
        <EditTaskDialog
          open={!!editingTask}
          onClose={() => setEditingTask(null)}
          task={editingTask}
          onSaved={() => {
            refetch();
            setEditingTask(null);
          }}
        />

        {/* Bug Report Dialog */}
        <BugReportDialog
          open={showBugDialog}
          onClose={handleCloseBug}
          onCreated={refetch}
          presetLabels={
            presetGoalForBug ? [`goal:${presetGoalForBug.id}`] : undefined
          }
        />

        {/* Keyboard Shortcuts Dialog */}
        <KeyboardShortcutsDialog
          open={showShortcutsHelp}
          onClose={() => setShowShortcutsHelp(false)}
        />

        {/* Branch Cleanup Dialog */}
        <BranchCleanupDialog
          open={showBranchCleanup}
          onClose={() => setShowBranchCleanup(false)}
        />

        {/* Goal-first: inline goal dialogs */}
        <CreateGoalDialog
          open={showCreateGoal}
          onClose={() => setShowCreateGoal(false)}
          onCreated={() => setShowCreateGoal(false)}
        />
        {editingGoal ? (
          <EditGoalDialog
            goal={editingGoal}
            onClose={() => setEditingGoal(null)}
            onSaved={() => setEditingGoal(null)}
          />
        ) : null}
        <GoalDiscussionDialog
          goal={discussingGoal}
          onClose={() => setDiscussingGoal(null)}
        />
        <ConfirmDialog
          open={!!pendingDeleteGoal}
          title="Remove this goal?"
          description={
            pendingDeleteGoal
              ? `"${pendingDeleteGoal.name}" will be removed from the goals manifest. Tasks attached to it keep their goal:${pendingDeleteGoal.id} label until you remove it manually.`
              : ""
          }
          variant="destructive"
          confirmLabel="Remove goal"
          onConfirm={() => {
            if (!pendingDeleteGoal) return;
            const target = pendingDeleteGoal;
            deleteGoalMutation.mutate(target.id, {
              onSuccess: () => setPendingDeleteGoal(null),
            });
          }}
          onClose={() => setPendingDeleteGoal(null)}
        />
      </div>
    </ErrorBoundary>
  );
}
