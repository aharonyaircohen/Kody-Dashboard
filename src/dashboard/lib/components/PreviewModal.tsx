/**
 * @fileType component
 * @domain kody
 * @pattern preview-modal
 * @ai-summary Full-screen modal overlay showing PR preview: iframe, changes, comments, actions
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { KodyTask, FileChange } from "../types";
import { prsApi } from "../api";
import { PreviewActions } from "./PreviewActions";
import { PRCommentList } from "./PRCommentList";
import { AddCommentDialog } from "./AddCommentDialog";
import { toast } from "sonner";
import { CIStatusBadge } from "./CIStatusBadge";
import { ActionStatusBadge } from "./ActionStatusBadge";
import { FileDiff } from "./FileDiff";
import { MergeConflictBanner } from "./MergeConflictBanner";
import { CIFailureBanner } from "./CIFailureBanner";
import { BranchBehindBanner } from "./BranchBehindBanner";
import { KodyChat } from "./KodyChat";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { cn, getPreviewBypassUrl } from "../utils";
import { useElementPicker } from "../picker/useElementPicker";
import {
  formatPickedElement,
  formatPickedElementLabel,
} from "../picker/protocol";
import {
  ArrowLeft,
  GitPullRequest,
  ExternalLink,
  GitBranch,
  MessageSquare,
  Loader2,
  AlertCircle,
  RefreshCw,
  Monitor,
  ChevronRight,
  ChevronDown,
  MousePointerClick,
  Puzzle,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";

type PreviewTab = "preview" | "changes" | "comments";

const CHAT_WIDTH_KEY = "kody.chatPanelWidth";
const CHAT_WIDTH_MIN = 320;
const CHAT_WIDTH_MAX = 1600;
const CHAT_WIDTH_SSR_FALLBACK = 600;

function getInitialChatWidth(): number {
  if (typeof window === "undefined") return CHAT_WIDTH_SSR_FALLBACK;
  const stored = Number(window.localStorage.getItem(CHAT_WIDTH_KEY));
  if (!Number.isFinite(stored) || stored <= 0) {
    const half = Math.floor(window.innerWidth / 2);
    return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, half));
  }
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, stored));
}

function getDefaultChatWidth(): number {
  if (typeof window === "undefined") return CHAT_WIDTH_SSR_FALLBACK;
  const half = Math.floor(window.innerWidth / 2);
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, half));
}

interface PreviewModalProps {
  task: KodyTask;
  onClose: () => void;
  onMerge: () => Promise<void>;
  isMerging: boolean;
  onRefresh?: () => void | Promise<unknown>;
  isRefreshing?: boolean;
}

export function PreviewModal({
  task,
  onClose,
  onMerge,
  isMerging,
  onRefresh,
  isRefreshing,
}: PreviewModalProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>(() => {
    if (typeof window === "undefined") return "preview";
    const path = window.location.pathname;
    if (path.endsWith("/changes")) return "changes";
    if (path.endsWith("/comments")) return "comments";
    return "preview";
  });
  const { githubUser } = useGitHubIdentity();
  const [chatPanelWidth, setChatPanelWidth] =
    useState<number>(getInitialChatWidth);
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
      const clamped = Math.min(
        CHAT_WIDTH_MAX,
        Math.max(CHAT_WIDTH_MIN, ev.clientX),
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
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [previewView, setPreviewView] = useState<"web" | "admin">("web");
  const [previewKey, setPreviewKey] = useState(0); // Bump to force iframe remount/refresh
  const [commentsKey, setCommentsKey] = useState(0); // Used to force-refresh comment list
  const [changesKey, setChangesKey] = useState(0); // Bump to force re-fetch of changed files
  const [localRefreshing, setLocalRefreshing] = useState(false);
  const [showCommentDialog, setShowCommentDialog] = useState(false);

  // Element picker: requires the Kody Element Picker browser extension (the
  // preview is a cross-origin iframe the page itself can't reach into). On a
  // click in the preview, the selected element is appended to the chat composer.
  const [composerInjection, setComposerInjection] = useState<{
    id: string;
    label: string;
    context: string;
  } | null>(null);
  const picker = useElementPicker({
    onSelect: (el) => {
      setComposerInjection({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label: formatPickedElementLabel(el),
        context: formatPickedElement(el),
      });
      toast.success(`Added ${formatPickedElementLabel(el)} to chat`);
    },
  });

  const handleRefreshAll = useCallback(async () => {
    setLocalRefreshing(true);
    setPreviewKey((k) => k + 1);
    setCommentsKey((k) => k + 1);
    setChangesKey((k) => k + 1);
    try {
      await onRefresh?.();
    } finally {
      setLocalRefreshing(false);
    }
  }, [onRefresh]);

  const refreshing = !!isRefreshing || localRefreshing;

  const pr = task.associatedPR;
  const actorLogin = githubUser?.login;

  // Callback to refresh comment list after adding a comment
  const handleCommentAdded = () => {
    setCommentsKey((k) => k + 1);
  };

  const handleCommentSubmit = async (body: string) => {
    if (!pr) return;
    try {
      await prsApi.postComment(pr.number, body, actorLogin);
      toast.success("Comment added");
      handleCommentAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add comment");
      throw err; // re-throw so dialog stays open
    }
  };

  // Get preview URL based on current view (web or admin)
  const getPreviewUrl = () => {
    if (!task.previewUrl) return null;
    const baseUrl = task.previewUrl;
    if (previewView === "admin") {
      // Ensure single slash between base URL and /admin
      const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
      return `${normalized}/admin`;
    }
    return baseUrl;
  };

  // Load tab data on demand
  useEffect(() => {
    if (!pr) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const loadData = async () => {
      try {
        if (activeTab === "changes") {
          const files = await prsApi.files(pr.number);
          if (!cancelled) {
            setChanges(files);
            // All files collapsed by default; user expands what they want.
            setExpandedFiles(new Set());
          }
        }
        // comments tab loads its own data via PRCommentList
      } catch (err) {
        console.error("[PreviewModal] Error loading data:", err);
        if (!cancelled)
          setLoadError(
            err instanceof Error ? err.message : "Failed to load data",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [activeTab, pr, task.id, changesKey]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Sync tab from URL on browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      // If navigated away from preview entirely, parent handles it
      if (!path.includes("/preview")) return;

      // Sync tab
      if (path.endsWith("/changes")) setActiveTab("changes");
      else if (path.endsWith("/comments")) setActiveTab("comments");
      else setActiveTab("preview");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (!pr) {
    return (
      <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-zinc-400">
            No pull request associated with this task yet.
          </p>
          <Button variant="outline" onClick={onClose}>
            Back to task
          </Button>
        </div>
      </div>
    );
  }

  const prFilesUrl = `${pr.html_url}/files`;
  const totalAdditions = changes.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = changes.reduce((s, f) => s + f.deletions, 0);

  const tabs: Array<{
    key: PreviewTab;
    label: string;
    icon: typeof GitBranch;
    count?: number;
  }> = [
    { key: "preview", label: "Preview", icon: Monitor },
    { key: "changes", label: "Changes", icon: GitBranch },
    {
      key: "comments",
      label: "Comments",
      icon: MessageSquare,
      count: commentCount ?? undefined,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 backdrop-blur-sm">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="gap-1.5 text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        <div className="h-4 w-px bg-zinc-800" />

        <GitPullRequest className="w-4 h-4 text-purple-400 shrink-0" />
        <a
          href={pr.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-white truncate hover:text-purple-400 hover:underline transition-colors"
          title="Open PR on GitHub"
        >
          PR #{pr.number}
        </a>
        <CIStatusBadge prNumber={pr.number} />
        <ActionStatusBadge taskId={task.id} />
        <span className="text-sm text-zinc-500 truncate hidden sm:inline">
          {pr.title}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={refreshing}
            title="Refresh PR details, changes, and comments"
            aria-label="Refresh PR details"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={cn("w-3 h-3", refreshing && "animate-spin")}
            />
            Refresh
          </button>
          <a
            href={pr.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 transition-colors"
          >
            <GitPullRequest className="w-3 h-3" />
            GitHub
          </a>
        </div>
      </div>

      {/* Body: chat panel (left) + main column (tabs + content + actions) */}
      <div className="flex-1 min-h-0 flex">
        {/* Chat panel — left, resizable, desktop only (matches dashboard) */}
        <div
          className="relative hidden md:block border-r border-zinc-800 shrink-0"
          style={{ width: `${chatPanelWidth}px` }}
        >
          <KodyChat
            context={{ kind: "task", task }}
            actorLogin={githubUser?.login}
            composerInjection={composerInjection}
          />
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

        {/* Main column */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Tab bar */}
          <div
            role="tablist"
            className="shrink-0 flex border-b border-zinc-800 bg-zinc-950/50"
          >
            {tabs.map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                role="tab"
                id={`preview-tab-${key}`}
                aria-selected={activeTab === key}
                aria-controls={`preview-panel-${key}`}
                onClick={() => {
                  setActiveTab(key);
                  const base = `/${task.issueNumber}/preview`;
                  const path = key === "preview" ? base : `${base}/${key}`;
                  window.history.pushState(null, "", path);
                }}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2",
                  activeTab === key
                    ? "text-white border-blue-500"
                    : "text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {key === "changes" && changes.length > 0 && (
                  <span className="text-xs text-zinc-600 ml-1">
                    {changes.length}
                  </span>
                )}
                {key !== "changes" && count !== undefined && count > 0 && (
                  <span
                    className={cn(
                      "text-xs px-1.5 py-0.5 rounded-full tabular-nums ml-0.5",
                      activeTab === key
                        ? "bg-blue-500/20 text-blue-300"
                        : "bg-zinc-800 text-zinc-500",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div
            className={cn(
              "flex-1 min-h-0",
              activeTab === "preview"
                ? "flex flex-col"
                : "overflow-y-auto pb-20",
            )}
          >
            {/* Preview tab - iframe */}
            {activeTab === "preview" && (
              <div className="h-full flex flex-col">
                {/* Preview actions header */}
                {task.previewUrl && (
                  <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPreviewView("web")}
                        className={cn(
                          "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                          previewView === "web"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                            : "text-zinc-400 hover:text-white hover:bg-zinc-800",
                        )}
                      >
                        Web
                      </button>
                      <button
                        onClick={() => setPreviewView("admin")}
                        className={cn(
                          "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                          previewView === "admin"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                            : "text-zinc-400 hover:text-white hover:bg-zinc-800",
                        )}
                      >
                        Admin
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {picker.available ? (
                        <button
                          type="button"
                          onClick={picker.toggle}
                          title={
                            picker.armed
                              ? "Click an element in the preview (Esc to cancel)"
                              : "Pick an element from the preview into chat"
                          }
                          aria-pressed={picker.armed}
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border transition-colors",
                            picker.armed
                              ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border-zinc-700",
                          )}
                        >
                          <MousePointerClick className="w-3 h-3" />
                          {picker.armed ? "Picking…" : "Pick element"}
                        </button>
                      ) : (
                        <a
                          href="https://github.com/aharonyaircohen/Kody-Dashboard/blob/main/extension/README.md"
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Install the Kody Element Picker extension to select elements from the preview"
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white border border-zinc-700 transition-colors"
                        >
                          <Puzzle className="w-3 h-3" />
                          Get picker
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewKey((k) => k + 1)}
                        title="Refresh preview"
                        aria-label="Refresh preview"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Refresh
                      </button>
                      <a
                        href={getPreviewBypassUrl(getPreviewUrl()) || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open
                      </a>
                    </div>
                  </div>
                )}
                {/* iframe */}
                <div className="flex-1 min-h-0">
                  {task.previewUrl ? (
                    <iframe
                      key={`${previewView}-${previewKey}`}
                      src={getPreviewBypassUrl(getPreviewUrl()) || undefined}
                      title="Preview Deployment"
                      className="w-full h-full border-0 bg-white"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                        <div className="space-y-1">
                          <p className="text-sm text-zinc-300">
                            Preview is being built by Vercel…
                          </p>
                          <p className="text-xs text-zinc-500">
                            This usually takes a minute. The preview will appear
                            here automatically when ready.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Changes tab */}
            {activeTab === "changes" && (
              <div
                role="tabpanel"
                id="preview-panel-changes"
                aria-labelledby="preview-tab-changes"
                className="p-4"
              >
                {loadError ? (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {loadError}
                    </div>
                    <button
                      onClick={() => {
                        setLoadError(null);
                        setActiveTab("changes");
                      }}
                      className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </button>
                  </div>
                ) : loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                  </div>
                ) : changes.length === 0 ? (
                  <p className="text-center text-zinc-500 py-8">
                    No file changes
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-2 py-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-500">
                          {changes.length} file{changes.length !== 1 ? "s" : ""}{" "}
                          changed{" "}
                          <span className="text-green-500">
                            +{totalAdditions}
                          </span>{" "}
                          <span className="text-red-500">
                            -{totalDeletions}
                          </span>
                        </span>
                        <button
                          onClick={() => {
                            if (expandedFiles.size === changes.length) {
                              setExpandedFiles(new Set());
                            } else {
                              setExpandedFiles(
                                new Set(changes.map((f) => f.filename)),
                              );
                            }
                          }}
                          className="text-xs text-zinc-500 hover:text-zinc-300"
                        >
                          {expandedFiles.size === changes.length
                            ? "Collapse all"
                            : "Expand all"}
                        </button>
                      </div>
                      <a
                        href={prFilesUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                      >
                        View on GitHub
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="space-y-2">
                      {changes.map((file) => {
                        const isOpen = expandedFiles.has(file.filename);
                        const fileGitHubUrl = `${prFilesUrl}#diff-${file.filename}`;
                        return (
                          <div
                            key={file.filename}
                            className="border border-zinc-800 rounded overflow-hidden"
                          >
                            <button
                              onClick={() => {
                                setExpandedFiles((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(file.filename)) {
                                    next.delete(file.filename);
                                  } else {
                                    next.add(file.filename);
                                  }
                                  return next;
                                });
                              }}
                              className="w-full flex items-center justify-between p-2 hover:bg-zinc-800/50 text-left group bg-zinc-900/50"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isOpen ? (
                                  <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
                                )}
                                <span
                                  className={cn(
                                    "text-xs font-mono shrink-0",
                                    file.status === "added"
                                      ? "text-green-400"
                                      : file.status === "removed"
                                        ? "text-red-400"
                                        : file.status === "renamed"
                                          ? "text-blue-400"
                                          : "text-yellow-400",
                                  )}
                                >
                                  {file.status === "added"
                                    ? "A"
                                    : file.status === "removed"
                                      ? "D"
                                      : file.status === "renamed"
                                        ? "R"
                                        : "M"}
                                </span>
                                <span className="text-sm truncate">
                                  {file.previousFilename ? (
                                    <>
                                      <span className="text-zinc-500 line-through">
                                        {file.previousFilename}
                                      </span>{" "}
                                      →{" "}
                                    </>
                                  ) : null}
                                  {file.filename}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-zinc-500 shrink-0">
                                <span className="text-green-500">
                                  +{file.additions}
                                </span>
                                <span className="text-red-500">
                                  -{file.deletions}
                                </span>
                                <a
                                  href={fileGitHubUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="Open on GitHub"
                                  className="opacity-0 group-hover:opacity-100 hover:text-blue-400"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="border-t border-zinc-800">
                                {file.patch ? (
                                  <FileDiff
                                    patch={file.patch}
                                    filename={file.filename}
                                  />
                                ) : (
                                  <div className="p-3 text-xs text-zinc-500 text-center">
                                    Diff not available (binary or too large).{" "}
                                    <a
                                      href={fileGitHubUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-400 hover:text-blue-300"
                                    >
                                      View on GitHub
                                    </a>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Comments tab */}
            {activeTab === "comments" && (
              <div
                role="tabpanel"
                id="preview-panel-comments"
                aria-labelledby="preview-tab-comments"
                className="p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Conversation
                    {commentCount !== null && commentCount > 0 && (
                      <span className="ml-2 text-zinc-600 normal-case tracking-normal">
                        {commentCount}
                      </span>
                    )}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowCommentDialog(true)}
                    className="group inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-all hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-200 active:scale-[0.97]"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-zinc-500 transition-colors group-hover:text-blue-300" />
                    Add comment
                  </button>
                </div>
                <PRCommentList
                  key={`${pr.number}-${commentsKey}`}
                  prNumber={pr.number}
                  onCountChange={setCommentCount}
                />
              </div>
            )}
          </div>

          {/* Conflict banner — only renders when hasConflicts === true */}
          <MergeConflictBanner prNumber={pr.number} />

          {/* CI failure banner — only renders when ciStatus === 'failure' (and no conflicts) */}
          <CIFailureBanner prNumber={pr.number} />

          {/* Branch-behind banner — soft warning, only when no conflicts and CI not failing */}
          <BranchBehindBanner prNumber={pr.number} />

          {/* Action bar */}
          <PreviewActions
            task={task}
            onMerge={onMerge}
            isMerging={isMerging}
            onCancelPR={onClose}
          />
        </div>
      </div>

      <AddCommentDialog
        isOpen={showCommentDialog}
        onClose={() => setShowCommentDialog(false)}
        onSubmit={handleCommentSubmit}
        prNumber={pr.number}
      />
    </div>
  );
}
