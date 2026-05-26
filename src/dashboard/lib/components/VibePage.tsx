/**
 * @fileType component
 * @domain kody
 * @pattern vibe-page
 * @ai-summary Vibe Coding view — chat (via persistent ChatRailShell) + live
 *   preview iframe + compact issue list. Selecting an issue swaps both the
 *   chat scope and the iframe; merging an issue removes it from the list.
 *   Reuses KodyChat (root layout), PreviewActions, MergeButton, CIStatusBadge.
 *   Default preview URL persists per-repo in `.kody/dashboard.json`.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  ListChecks,
  Loader2,
  MousePointerClick,
  Puzzle,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dashboard/ui/sheet";
import { cn, getPreviewBypassUrl } from "../utils";
import { useChatScope } from "./ChatRailShell";
import { useElementPicker } from "../picker/useElementPicker";
import {
  formatPickedElement,
  formatPickedElementLabel,
} from "../picker/protocol";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useKodyTasks } from "../hooks";
import { tasksApi, getStoredAuth, redirectToLogin } from "../api";
import { RateLimitError, NoTokenError, SessionExpiredError } from "../api";
import type { KodyTask } from "../types";

import { VibeIssueList } from "./VibeIssueList";
import { VibeDefaultPreviewField } from "./VibeDefaultPreviewField";
import { PreviewActions } from "./PreviewActions";
import { CIStatusBadge } from "./CIStatusBadge";
import { KodyHeader } from "./KodyHeader";
import { MobileMenu } from "./MobileMenu";
import { SimpleTooltip } from "./SimpleTooltip";
import { TaskDetail } from "./TaskDetail";

interface DashboardConfigResponse {
  config: { version: 1; defaultPreviewUrl?: string };
}

// Optimistic pins for just-created issues, kept at MODULE scope (not a
// component ref) so they survive a VibePage remount. Navigating to
// `?issue=N` after creating the issue remounts VibePage, which would reset a
// `useRef` pin to empty — leaving `selectedTask` null, the chat scope stuck
// on "global", and the runner hand-off unable to bind to the new issue.
// Keyed by issue number with a TTL so stale pins can't leak.
const OPTIMISTIC_PIN_TTL_MS = 120_000;
const optimisticTaskPins = new Map<number, { task: KodyTask; at: number }>();
function writeOptimisticPin(issueNumber: number, task: KodyTask): void {
  optimisticTaskPins.set(issueNumber, { task, at: Date.now() });
}
function readOptimisticPin(issueNumber: number): KodyTask | null {
  const entry = optimisticTaskPins.get(issueNumber);
  if (!entry) return null;
  if (Date.now() - entry.at > OPTIMISTIC_PIN_TTL_MS) {
    optimisticTaskPins.delete(issueNumber);
    return null;
  }
  return entry.task;
}
function dropOptimisticPin(issueNumber: number): void {
  optimisticTaskPins.delete(issueNumber);
}
function optimisticPinKeys(): number[] {
  return Array.from(optimisticTaskPins.keys());
}

async function fetchDashboardConfig(): Promise<DashboardConfigResponse> {
  const auth = getStoredAuth();
  if (!auth) throw new NoTokenError("No auth");
  const res = await fetch("/api/kody/dashboard-config", {
    headers: {
      "x-kody-token": auth.token,
      "x-kody-owner": auth.owner,
      "x-kody-repo": auth.repo,
    },
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new SessionExpiredError("Session expired");
  }
  if (!res.ok) throw new Error(`Failed to load config (${res.status})`);
  return (await res.json()) as DashboardConfigResponse;
}

async function saveDashboardConfig(
  defaultPreviewUrl: string,
  actorLogin?: string,
): Promise<DashboardConfigResponse> {
  const auth = getStoredAuth();
  if (!auth) throw new NoTokenError("No auth");
  const res = await fetch("/api/kody/dashboard-config", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-kody-token": auth.token,
      "x-kody-owner": auth.owner,
      "x-kody-repo": auth.repo,
    },
    body: JSON.stringify({ defaultPreviewUrl, actorLogin }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "Save failed");
    throw new Error(msg);
  }
  return (await res.json()) as DashboardConfigResponse;
}

export function VibePage() {
  const queryClient = useQueryClient();
  const { githubUser } = useGitHubIdentity();
  const { setScope, setOnIssueCreated, setComposerInjection } = useChatScope();

  // Element picker: clicking an element in the preview attaches it to the
  // chat composer (rendered by the rail, so we route through useChatScope).
  // Requires the Kody Element Picker browser extension (cross-origin iframe).
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

  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Selection is URL-driven (`/vibe?issue=N`) so refreshes and shared
  // links restore the same view. Local state mirrors the URL for fast
  // reads inside this render; router.replace keeps both in sync.
  const router = useRouter();
  const pathname = usePathname() ?? "/vibe";
  const searchParams = useSearchParams();
  const issueParam = searchParams?.get("issue") ?? null;
  const parsedIssue = issueParam ? Number.parseInt(issueParam, 10) : NaN;
  const urlIssueNumber: number | null =
    Number.isFinite(parsedIssue) && parsedIssue > 0 ? parsedIssue : null;

  const [selectedIssueNumber, setSelectedIssueNumberState] = useState<
    number | null
  >(urlIssueNumber);

  // Keep state aligned with URL changes (browser back/forward, deep links).
  useEffect(() => {
    setSelectedIssueNumberState(urlIssueNumber);
  }, [urlIssueNumber]);

  const setSelectedIssueNumber = useCallback(
    (next: number | null) => {
      setSelectedIssueNumberState(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === null) params.delete("issue");
      else params.set("issue", String(next));
      // Also clear any open detail overlay — selection swaps the
      // underlying preview, so leaving the overlay open masks the change.
      params.delete("detail");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Detail overlay — a separate URL param so refresh / share preserves it
  // and so back/forward closes it like a real navigation.
  const detailParam = searchParams?.get("detail") ?? null;
  const parsedDetail = detailParam ? Number.parseInt(detailParam, 10) : NaN;
  const urlDetailNumber: number | null =
    Number.isFinite(parsedDetail) && parsedDetail > 0 ? parsedDetail : null;
  const [detailIssueNumber, setDetailIssueNumberState] = useState<
    number | null
  >(urlDetailNumber);
  useEffect(() => {
    setDetailIssueNumberState(urlDetailNumber);
  }, [urlDetailNumber]);

  const setDetailIssueNumber = useCallback(
    (next: number | null) => {
      setDetailIssueNumberState(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === null) params.delete("detail");
      else params.set("detail", String(next));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // ESC closes the detail overlay (preview + chat stay where they were).
  useEffect(() => {
    if (detailIssueNumber === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailIssueNumber(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [detailIssueNumber, setDetailIssueNumber]);
  // Bump to force iframe remount on Refresh — same trick as PreviewModal.
  const [iframeKey, setIframeKey] = useState(0);
  // Same Web/Admin split as PreviewModal so vibe iterations can target /admin.
  const [previewView, setPreviewView] = useState<"web" | "admin">("web");
  // Mobile-only: the issue list lives in a Sheet so the preview can own
  // the screen. On desktop the Sheet stays closed; the aside renders.
  const [mobileIssuesOpen, setMobileIssuesOpen] = useState(false);

  const tasksQuery = useKodyTasks({ refetchInterval: "auto" });
  const tasks = tasksQuery.data;

  // Newly-created issues that we've optimistically pinned in the tasks
  // cache. GitHub's list-issues response can lag for tens of seconds
  // after a write (cache propagation on the dashboard server's side),
  // so a refetch that arrives between optimistic insert and the issue
  // actually appearing on the API will WIPE the synthetic record. When
  // that happens mid-vibe-handoff, `selectedTask` drops to null,
  // `context` drops to null, the chat-rail scope flips to 'global',
  // and the rehydrate useEffect blows away the booting interactive
  // session — symptom: kickoff `/append` never fires, runner idles,
  // PR stays empty. Pinning the new issue here keeps `selectedTask`
  // populated until the real fetch confirms the issue is present.
  // Render counter — force a re-render after the ref updates so the
  // memo below picks up the new pin without waiting for a parent
  // state change. Keeps the pin path side-effect free in the listener.
  const [pinnedRev, setPinnedRev] = useState(0);

  // Resolve the selected task fresh from query data on every render so
  // optimistic updates and refetches flow through without local state
  // drift. Falls back to the pinned synthetic when the real list
  // hasn't caught up yet — critical for the vibe handoff race above.
  const selectedTask = useMemo<KodyTask | null>(() => {
    if (selectedIssueNumber === null) return null;
    const real =
      tasks?.find((t) => t.issueNumber === selectedIssueNumber) ?? null;
    if (real) {
      // Real task is here — drop the pin if we still hold one for this
      // issue (deferred to a useEffect to avoid mutating in render).
      return real;
    }
    return readOptimisticPin(selectedIssueNumber);
    // pinnedRev is in the dep array so React picks up pinned-map
    // changes (the module-map mutation alone isn't observable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIssueNumber, tasks, pinnedRev]);

  // Drop pins for issues that have now appeared in the real fetch.
  // We do this outside the memo so render stays pure.
  useEffect(() => {
    if (!tasks || optimisticTaskPins.size === 0) return;
    let removed = false;
    for (const issueNumber of optimisticPinKeys()) {
      const inTasks = tasks.find((t) => t.issueNumber === issueNumber);
      // Drop the pin only when a REAL task object shows up — NOT the synthetic
      // we ourselves inserted into the query cache. Comparing by identity is
      // load-bearing: dropping on mere presence makes our own optimistic
      // insert trigger the removal, after which the next (still-lagging)
      // refetch returns a list without the issue and selectedTask goes null —
      // the chat scope never flips and the runner hand-off can't bind.
      if (inTasks && inTasks !== readOptimisticPin(issueNumber)) {
        dropOptimisticPin(issueNumber);
        removed = true;
      }
    }
    if (removed) setPinnedRev((r) => r + 1);
  }, [tasks]);

  // Same pattern for the detail overlay — resolve from query data so it
  // reflects optimistic edits/refetches without local copies drifting.
  const detailTask = useMemo<KodyTask | null>(() => {
    if (detailIssueNumber === null || !tasks) return null;
    return tasks.find((t) => t.issueNumber === detailIssueNumber) ?? null;
  }, [detailIssueNumber, tasks]);

  // Push the selected task into the persistent chat rail so KodyChat
  // re-scopes its context (system prompt, attached issue, history).
  useEffect(() => {
    if (selectedTask) {
      setScope({ kind: "task", task: selectedTask });
    } else {
      setScope(null);
    }
    // Clear scope on unmount so other pages don't inherit our selection.
    return () => setScope(null);
  }, [selectedTask, setScope]);

  // When the chat creates a new issue (via `create_*` / `report_bug`), the
  // chat has already migrated its running messages to that issue's chat
  // store. Our job is to navigate the Vibe page onto the new issue so the
  // user lands there and sees the transferred conversation. We also kick
  // a task-list refetch so the issue appears in the sidebar without
  // waiting for the poll interval.
  //
  // OPTIMISTIC INSERT — without this, `selectedTask` stays null until the
  // tasks query refetches AND the server-side ETag cache invalidates,
  // which can take 30+ seconds on a cold path. While `selectedTask` is
  // null, the chat scope falls back to 'global' and the kickoff
  // useEffect (which gates on context.kind === 'task' matching the new
  // issue) never fires — workflow_dispatch lands on the previously-
  // viewed issue's sessionId and the new PR stays empty.
  //
  // We insert a synthetic minimal KodyTask into every active tasks
  // query immediately so selectedTask resolves on the next render.
  // The next real fetch replaces the synthetic record with the real
  // one (same id, so React Query dedupes cleanly).
  useEffect(() => {
    setOnIssueCreated((issueNumber: number) => {
      const synthetic: KodyTask = {
        id: String(issueNumber),
        issueNumber,
        title: "(new — loading)",
        body: "",
        state: "open",
        labels: [],
        column: "open",
        kodyPhase: null,
        kodyFlow: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Pin the synthetic at module scope so it survives the remount that
      // navigating to `?issue=N` triggers (a useRef pin would be wiped).
      writeOptimisticPin(issueNumber, synthetic);
      setPinnedRev((r) => r + 1);
      // Also write into the cache so list views render the new row
      // without waiting on the next poll. Both paths converge once the
      // real fetch returns including the new issue.
      queryClient.setQueriesData<KodyTask[]>(
        { queryKey: ["kody-tasks"] },
        (prev) => {
          if (!Array.isArray(prev)) return prev;
          if (prev.some((t) => t.issueNumber === issueNumber)) return prev;
          return [synthetic, ...prev];
        },
      );
      queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
      setSelectedIssueNumber(issueNumber);
    });
    return () => setOnIssueCreated(null);
  }, [setOnIssueCreated, setSelectedIssueNumber, queryClient]);

  // ── Dashboard config (default preview URL) ──────────────────────────────
  const configQuery = useQuery({
    queryKey: ["kody-dashboard-config"],
    queryFn: fetchDashboardConfig,
    enabled: !!getStoredAuth(),
    staleTime: 5 * 60 * 1000,
    retry: (count, err) => {
      if (err instanceof RateLimitError) return false;
      if (err instanceof NoTokenError) return false;
      if (err instanceof SessionExpiredError) return false;
      return count < 2;
    },
  });
  const defaultPreviewUrl = configQuery.data?.config.defaultPreviewUrl ?? "";

  const saveConfigMutation = useMutation({
    mutationFn: (url: string) => saveDashboardConfig(url, githubUser?.login),
    onSuccess: (data) => {
      queryClient.setQueryData(["kody-dashboard-config"], data);
      toast.success("Default preview saved");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to save preview URL",
      );
    },
  });

  // ── Merge — mirrors KodyDashboard so we get the same optimistic UX. ─────
  const mergeMutation = useMutation({
    mutationFn: (task: KodyTask) =>
      tasksApi.approveReview(task, githubUser?.login),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: ["kody-tasks"] });
      const previous = queryClient.getQueriesData<KodyTask[]>({
        queryKey: ["kody-tasks"],
      });
      queryClient.setQueriesData<KodyTask[]>(
        { queryKey: ["kody-tasks"] },
        (old) =>
          old?.map((t) =>
            t.id === task.id ? { ...t, column: "done" as const } : t,
          ),
      );
      return { previous };
    },
    onError: (_err, _task, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error("Failed to merge PR");
    },
    onSuccess: () => {
      toast.success("PR merged");
      // The issue closes server-side — drop our selection so the empty
      // pane (default preview) shows briefly before the row disappears
      // from the list on next refetch.
      setSelectedIssueNumber(null);
      queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
    },
  });

  const mergingTaskId = mergeMutation.isPending
    ? (mergeMutation.variables as KodyTask | undefined)?.id
    : null;

  const handleMerge = useCallback(async () => {
    if (!selectedTask) return;
    await mergeMutation.mutateAsync(selectedTask);
  }, [selectedTask, mergeMutation]);

  // ── Preview URL resolution ──────────────────────────────────────────────
  const activePreviewUrl = selectedTask?.previewUrl ?? null;
  const fallbackPreviewUrl = !selectedTask ? defaultPreviewUrl : null;
  const baseUrl = activePreviewUrl ?? fallbackPreviewUrl;
  // Append /admin when the user picks the Admin view — same logic as
  // PreviewModal.getPreviewUrl. Strip any trailing slash so we don't
  // end up with `//admin`.
  const previewUrl = useMemo(() => {
    if (!baseUrl) return null;
    if (previewView === "admin") {
      const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
      return `${normalized}/admin`;
    }
    return baseUrl;
  }, [baseUrl, previewView]);
  const bypassedUrl = useMemo(
    () => getPreviewBypassUrl(previewUrl),
    [previewUrl],
  );

  // Show the default-preview editor only on the empty pane and only when
  // there's no URL yet — otherwise it'd compete with the iframe.
  const showDefaultPreviewEditor = !selectedTask && !defaultPreviewUrl;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header — mirrors the Dashboard so navigation feels like a view
          toggle. The VibeToggle in the header reflects "on" via pathname. */}
      <KodyHeader
        onOpenMobileMenu={() => setShowMobileMenu(true)}
        onRefresh={() => {
          tasksQuery.refetch();
        }}
        isFetching={tasksQuery.isFetching}
        desktopExtras={
          <div className="flex items-center gap-3 min-w-0">
            {selectedTask?.associatedPR ? (
              <CIStatusBadge prNumber={selectedTask.associatedPR.number} />
            ) : null}
          </div>
        }
        mobileExtras={
          <SimpleTooltip content="Open issues">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileIssuesOpen(true)}
              aria-label="Open issues"
            >
              <ListChecks className="w-4 h-4" />
            </Button>
          </SimpleTooltip>
        }
      />

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Issue list — desktop aside */}
        <aside
          className="hidden md:flex flex-col shrink-0 w-[260px] border-r border-white/[0.06] bg-black/20 overflow-y-auto"
          aria-label="Open issues"
        >
          <VibeIssueList
            tasks={tasks}
            selectedIssueNumber={selectedIssueNumber}
            onSelect={(task) =>
              setSelectedIssueNumber(task ? task.issueNumber : null)
            }
            onOpenDetail={(task) => setDetailIssueNumber(task.issueNumber)}
            isLoading={tasksQuery.isLoading}
          />
        </aside>

        {/* Issue list — mobile Sheet */}
        <Sheet open={mobileIssuesOpen} onOpenChange={setMobileIssuesOpen}>
          <SheetContent side="left" className="w-[300px] p-0 flex flex-col">
            <SheetHeader className="px-4 py-3 border-b border-white/[0.06] space-y-0">
              <SheetTitle className="text-sm font-semibold">
                Open issues
              </SheetTitle>
              <SheetDescription className="sr-only">
                Select an issue to load its preview and chat
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <VibeIssueList
                tasks={tasks}
                selectedIssueNumber={selectedIssueNumber}
                onSelect={(task) => {
                  setSelectedIssueNumber(task ? task.issueNumber : null);
                  setMobileIssuesOpen(false);
                }}
                onOpenDetail={(task) => {
                  setDetailIssueNumber(task.issueNumber);
                  setMobileIssuesOpen(false);
                }}
                isLoading={tasksQuery.isLoading}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Preview pane — relative for the detail overlay below */}
        <section className="relative flex-1 min-w-0 flex flex-col">
          {/* Preview toolbar */}
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-black/20">
            <div className="flex items-center gap-3 min-w-0">
              <div className="text-xs text-zinc-400 truncate">
                {selectedTask ? (
                  <>
                    Preview •{" "}
                    <span className="text-zinc-300">
                      #{selectedTask.issueNumber}
                    </span>
                  </>
                ) : (
                  <>Default preview</>
                )}
              </div>
              {baseUrl && (
                <div
                  className="flex items-center gap-1"
                  role="tablist"
                  aria-label="Preview view"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewView("web")}
                    role="tab"
                    aria-selected={previewView === "web"}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                      previewView === "web"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800 border border-transparent",
                    )}
                  >
                    Web
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewView("admin")}
                    role="tab"
                    aria-selected={previewView === "admin"}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                      previewView === "admin"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800 border border-transparent",
                    )}
                  >
                    Admin
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {previewUrl && (
                <>
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
                        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors",
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
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white border border-zinc-700 transition-colors"
                    >
                      <Puzzle className="w-3 h-3" />
                      Get picker
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setIframeKey((k) => k + 1)}
                    title="Refresh preview"
                    aria-label="Refresh preview"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                  <a
                    href={bypassedUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Iframe / empty states */}
          <div
            className={cn(
              "flex-1 min-h-0",
              previewUrl ? "bg-white" : "bg-zinc-950",
            )}
          >
            {previewUrl ? (
              <iframe
                key={`${previewUrl}-${iframeKey}`}
                src={bypassedUrl ?? undefined}
                title="Preview deployment"
                className="w-full h-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            ) : showDefaultPreviewEditor ? (
              <div className="h-full flex items-center justify-center p-6">
                {configQuery.isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                ) : (
                  <VibeDefaultPreviewField
                    value={defaultPreviewUrl}
                    onSave={async (url) => {
                      await saveConfigMutation.mutateAsync(url);
                    }}
                    isSaving={saveConfigMutation.isPending}
                  />
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                <p className="text-sm text-zinc-300">No preview yet</p>
                <p className="text-xs text-zinc-500 max-w-md">
                  Once a PR is opened for this issue, its Vercel preview will
                  appear here. Use the chat to start.
                </p>
              </div>
            )}
          </div>

          {/* Approve / merge bar — only when a task with a PR is selected. */}
          {selectedTask?.associatedPR && (
            <PreviewActions
              task={selectedTask}
              onMerge={handleMerge}
              isMerging={mergingTaskId === selectedTask.id}
              onCancelPR={() => setSelectedIssueNumber(null)}
            />
          )}

          {/* Issue detail overlay — scoped to the preview pane only.
              Stays on Vibe (no route change), preserves chat scope, and
              ESC / X / row-select all close it. */}
          {detailTask && (
            <>
              <button
                type="button"
                aria-label="Close issue details"
                onClick={() => setDetailIssueNumber(null)}
                className="absolute inset-0 bg-black/40 backdrop-blur-[1px] z-40 animate-in fade-in duration-150"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Issue #${detailTask.issueNumber} details`}
                className="absolute inset-0 z-50 bg-[#0a0a0a] border-l border-white/[0.06] shadow-2xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-right-4 duration-200"
              >
                <TaskDetail
                  task={detailTask}
                  onClose={() => setDetailIssueNumber(null)}
                  onRefresh={() => tasksQuery.refetch()}
                  onOpenPreview={() => {
                    // "Open preview" from inside the overlay = make this
                    // issue the selected one and dismiss the overlay.
                    setSelectedIssueNumber(detailTask.issueNumber);
                    setDetailIssueNumber(null);
                  }}
                  // Vibe owns its URL (`/vibe?detail=N`). Letting TaskDetail
                  // pushState `/{issueNumber}/comments` strips `?detail=N`,
                  // closes this overlay, and parks the URL on the dashboard
                  // route. Keep tab state in-memory only.
                  syncTabToUrl={false}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {/* Mobile menu — shared component; we just slot in the vibe-only
          "Open issues" entry as the workspace primary action. */}
      <MobileMenu
        open={showMobileMenu}
        onOpenChange={setShowMobileMenu}
        workspacePrimary={
          <button
            type="button"
            onClick={() => {
              setShowMobileMenu(false);
              setMobileIssuesOpen(true);
            }}
            className="flex items-center gap-3 h-12 w-full px-3 rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10">
              <ListChecks className="w-4 h-4 text-emerald-300" />
            </span>
            <span className="text-sm font-medium">Open issues</span>
          </button>
        }
      />
    </div>
  );
}
