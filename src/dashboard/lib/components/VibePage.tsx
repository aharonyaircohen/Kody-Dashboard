/**
 * @fileType component
 * @domain kody
 * @pattern vibe-page
 * @ai-summary Vibe Coding view — chat (via persistent ChatRailShell) + live
 *   preview iframe + compact issue list. Selecting an issue swaps both the
 *   chat scope and the iframe; merging an issue removes it from the list.
 *   Reuses KodyChat (root layout), PreviewBrowser, PreviewActions,
 *   MergeButton, CIStatusBadge. Default preview URL persists per-repo in
 *   state repo `dashboard.json`.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GitBranch, ListChecks, Loader2 } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dashboard/ui/sheet";
import { useChatScope } from "./ChatRailShell";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useKodyTasks } from "../hooks";
import { usePreviewUrl } from "../hooks/usePreviewUrl";
import { PreviewBrowser } from "./PreviewBrowser";
import { PreviewBranchEnvForm } from "./PreviewBranchEnvForm";
import { PreviewEnvSwitcher } from "./PreviewEnvSwitcher";
import { VaultLockedBanner } from "./VaultLockedBanner";
import {
  fetchDashboardConfig,
  saveDashboardConfig,
} from "../dashboard-config/client";
import {
  addBranchPreviewEnvironment,
  isFlyBranchEnvironment,
  normalizeBranchName,
  resolveEnvironments,
  resolvePreviewFolders,
  type PreviewEnvironment,
  type PreviewEnvironmentFolder,
} from "../preview-environments";
import {
  BRANCH_PREVIEW_POLL_MS,
  branchPreviewNeedsPoll,
  fetchBranchPreviews,
} from "../previews/branch-preview-client";
import { previewChatContextBlock } from "../chat/core/preview-context";
import { tasksApi, getStoredAuth } from "../api";
import { RateLimitError, NoTokenError, SessionExpiredError } from "../api";
import type { KodyTask } from "../types";
import { mapTaskCacheData, type TaskCacheData } from "../tasks/cache";

import { VibeIssueList } from "./VibeIssueList";
import { VibeDefaultPreviewField } from "./VibeDefaultPreviewField";
import { PreviewActions } from "./PreviewActions";
import { CIStatusBadge } from "./CIStatusBadge";
import { KodyHeader } from "./KodyHeader";
import { MobileMenu } from "./MobileMenu";
import { SimpleTooltip } from "./SimpleTooltip";
import { TaskDetail } from "./TaskDetail";
import { VibeRunButton } from "./VibeRunButton";

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

function previewSelectionKey(owner: string, repo: string): string {
  return `kody.previewEnv.${owner}/${repo}`;
}

export function VibePage() {
  const queryClient = useQueryClient();
  const { githubUser } = useGitHubIdentity();
  const {
    setScope,
    setOnIssueCreated,
    setComposerInjection,
    setAttachmentInjection,
    setPreviewContext,
  } = useChatScope();

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
  // Repo identity for the preview pane's per-repo views + inspector storage.
  const ownerForViews = getStoredAuth()?.owner ?? "";
  const repoForViews = getStoredAuth()?.repo ?? "";
  // Mobile-only: the issue list lives in a Sheet so the preview can own
  // the screen. On desktop the Sheet stays closed; the aside renders.
  const [mobileIssuesOpen, setMobileIssuesOpen] = useState(false);

  const tasksQuery = useKodyTasks({
    includeDetails: true,
    refetchInterval: "auto",
  });
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
  const selectedIssueIsActive = selectedIssueNumber !== null;

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
      queryClient.setQueriesData<TaskCacheData>(
        { queryKey: ["kody-tasks"] },
        (prev) => {
          return mapTaskCacheData(prev, (tasks) => {
            if (tasks.some((t) => t.issueNumber === issueNumber)) return tasks;
            return [synthetic, ...tasks];
          });
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
  const environments = useMemo(
    () => resolveEnvironments(configQuery.data?.config),
    [configQuery.data?.config],
  );
  const previewFolders = useMemo(
    () => resolvePreviewFolders(configQuery.data?.config.previewFolders),
    [configQuery.data?.config.previewFolders],
  );
  const hasExplicitEnvironments = Array.isArray(
    configQuery.data?.config.namedPreviews,
  );

  const saveDefaultPreviewMutation = useMutation({
    mutationFn: (url: string) =>
      saveDashboardConfig({
        defaultPreviewUrl: url,
        actorLogin: githubUser?.login,
      }),
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

  const saveEnvironmentsMutation = useMutation({
    mutationFn: (next: PreviewEnvironment[]) =>
      saveDashboardConfig({
        namedPreviews: next,
        actorLogin: githubUser?.login,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["kody-dashboard-config"], data);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to save preview environments",
      );
    },
  });

  const saveFoldersMutation = useMutation({
    mutationFn: (next: PreviewEnvironmentFolder[]) =>
      saveDashboardConfig({
        previewFolders: next,
        actorLogin: githubUser?.login,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["kody-dashboard-config"], data);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to save preview folders",
      );
    },
  });

  const [storedEnvId, setStoredEnvId] = useState<string | null>(null);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerForViews || !repoForViews) return;
    try {
      setStoredEnvId(
        window.localStorage.getItem(
          previewSelectionKey(ownerForViews, repoForViews),
        ),
      );
    } catch {
      /* private mode - ignore */
    }
  }, [ownerForViews, repoForViews]);

  useEffect(() => {
    if (environments.length === 0) {
      if (selectedEnvId !== null) setSelectedEnvId(null);
      return;
    }
    if (selectedEnvId && environments.some((e) => e.id === selectedEnvId)) {
      return;
    }
    const fallback =
      environments.find((env) => env.id === storedEnvId) ?? environments[0]!;
    setSelectedEnvId(fallback.id);
  }, [environments, selectedEnvId, storedEnvId]);

  const selectedEnv =
    environments.find((e) => e.id === selectedEnvId) ?? environments[0] ?? null;

  const persistPreviewEnvironments = async (
    next: PreviewEnvironment[],
  ): Promise<void> => {
    await saveEnvironmentsMutation.mutateAsync(next);
  };

  const persistPreviewFolders = async (
    next: PreviewEnvironmentFolder[],
  ): Promise<void> => {
    await saveFoldersMutation.mutateAsync(next);
  };

  const selectEnv = useCallback(
    (env: PreviewEnvironment): void => {
      setSelectedEnvId(env.id);
      try {
        window.localStorage.setItem(
          previewSelectionKey(ownerForViews, repoForViews),
          env.id,
        );
      } catch {
        /* ignore */
      }
      setSelectedIssueNumber(null);
    },
    [ownerForViews, repoForViews, setSelectedIssueNumber],
  );

  const repoFullName =
    ownerForViews && repoForViews ? `${ownerForViews}/${repoForViews}` : "";

  const addBranch = async (repoRef: string, branch: string): Promise<void> => {
    if (repoRef !== repoFullName) throw new Error("Use the connected repo");

    const cleanBranch = normalizeBranchName(branch);
    if (!cleanBranch) throw new Error("Enter a valid branch");

    const list = await fetchBranchPreviews();
    if (!list.flyConfigured) throw new Error("Fly previews are not configured");
    const tracked = list.previews.find(
      (preview) => preview.branch === cleanBranch,
    );
    if (!tracked) throw new Error("Create this branch preview in Fly first");

    const existing = environments.find(
      (env) =>
        isFlyBranchEnvironment(env) &&
        env.flyBranch.repo === repoRef &&
        env.flyBranch.branch === cleanBranch,
    );
    if (existing) {
      selectEnv(existing);
      toast.info(`"${existing.label}" is already saved`);
      return;
    }

    const next = addBranchPreviewEnvironment(
      environments,
      repoRef,
      cleanBranch,
    );
    await persistPreviewEnvironments(next);
    const created = next[next.length - 1];
    if (created) selectEnv(created);
    toast.success(`Saved "${created?.label ?? cleanBranch}"`);
  };

  // ── Merge — mirrors KodyDashboard so we get the same optimistic UX. ─────
  const mergeMutation = useMutation({
    mutationFn: (task: KodyTask) =>
      tasksApi.approveReview(task, githubUser?.login),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: ["kody-tasks"] });
      const previous = queryClient.getQueriesData<TaskCacheData>({
        queryKey: ["kody-tasks"],
      });
      queryClient.setQueriesData<TaskCacheData>(
        { queryKey: ["kody-tasks"] },
        (old) =>
          mapTaskCacheData(old, (tasks) =>
            tasks.map((t) =>
              t.id === task.id ? { ...t, column: "done" as const } : t,
            ),
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
  // Resolve the selected PR's preview directly by its head commit so it
  // appears immediately on open, instead of waiting for the background tasks
  // poll (which only finds links among the 100 most-recent deployments).
  const {
    url: activePreviewUrl,
    isResolving: previewResolving,
    wakePreview,
    refreshPreviewUrl,
  } = usePreviewUrl(
    selectedTask?.associatedPR?.head?.sha,
    selectedTask?.associatedPR?.number,
    selectedTask?.previewUrl ?? null,
  );

  const selectedFlyBranch = isFlyBranchEnvironment(selectedEnv)
    ? selectedEnv.flyBranch
    : null;
  const selectedFlyBranchMatchesRepo =
    !!selectedFlyBranch && selectedFlyBranch.repo === repoFullName;
  const selectedPollingBranch = selectedFlyBranchMatchesRepo
    ? selectedFlyBranch.branch
    : null;
  const branchPreviewsQuery = useQuery({
    queryKey: ["kody-branch-previews", ownerForViews, repoForViews],
    queryFn: fetchBranchPreviews,
    enabled:
      !selectedIssueIsActive &&
      !!selectedFlyBranchMatchesRepo &&
      !!ownerForViews &&
      !!repoForViews,
    staleTime: 15 * 60 * 1000,
    refetchInterval: (query) =>
      branchPreviewNeedsPoll(selectedPollingBranch, query.state.data)
        ? BRANCH_PREVIEW_POLL_MS
        : false,
    retry: false,
  });
  const resolvedBranchPreview = selectedFlyBranch
    ? branchPreviewsQuery.data?.previews.find(
        (preview) => preview.branch === selectedFlyBranch.branch,
      )
    : null;
  const selectedEnvironmentUrl = selectedFlyBranch
    ? (resolvedBranchPreview?.url ?? null)
    : (selectedEnv?.url ?? null);
  const branchPreviewIsResolving =
    !!selectedFlyBranchMatchesRepo &&
    !resolvedBranchPreview?.url &&
    (branchPreviewsQuery.isLoading ||
      branchPreviewsQuery.isFetching ||
      resolvedBranchPreview?.state === "pending" ||
      resolvedBranchPreview?.state === "building" ||
      resolvedBranchPreview?.state === "starting");
  const legacyFallbackPreviewUrl =
    !selectedEnv && !hasExplicitEnvironments ? defaultPreviewUrl : "";
  const fallbackPreviewUrl = !selectedIssueIsActive
    ? (selectedEnvironmentUrl ?? (legacyFallbackPreviewUrl.trim() || null))
    : null;
  const baseUrl = activePreviewUrl ?? fallbackPreviewUrl;

  useEffect(() => {
    if (selectedIssueIsActive) {
      setPreviewContext(null);
      return;
    }
    setPreviewContext(previewChatContextBlock(selectedEnv));
    return () => setPreviewContext(null);
  }, [selectedEnv, selectedIssueIsActive, setPreviewContext]);

  useEffect(() => {
    const error = branchPreviewsQuery.error;
    if (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to open branch preview",
      );
    }
  }, [branchPreviewsQuery.error]);

  const browserIsResolving = selectedIssueIsActive
    ? previewResolving
    : branchPreviewIsResolving;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header — mirrors the Dashboard so navigation feels like a view
          switch. Vibe is reached from the rail's "Views" group. */}
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
            onSelect={(task) => setSelectedIssueNumber(task.issueNumber)}
            onOpenDetail={(task) => setDetailIssueNumber(task.issueNumber)}
            isLoading={tasksQuery.isLoading}
          />
        </aside>

        {/* Issue list — mobile Sheet */}
        <Sheet open={mobileIssuesOpen} onOpenChange={setMobileIssuesOpen}>
          <SheetContent side="left" className="w-[300px] p-0 flex flex-col">
            <SheetHeader className="px-4 py-3 border-b border-white/[0.06] space-y-0">
              <SheetTitle className="text-heading-md font-semibold">
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
                  setSelectedIssueNumber(task.issueNumber);
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
          <PreviewBrowser
            baseUrl={baseUrl}
            isResolving={browserIsResolving}
            owner={ownerForViews}
            repo={repoForViews}
            showBrowserChrome
            onComposerInjection={setComposerInjection}
            onAttachmentInjection={setAttachmentInjection}
            onRefreshPreviewUrl={refreshPreviewUrl}
            onBeforePreviewLoad={wakePreview}
            leadingToolbar={
              <PreviewEnvSwitcher
                environments={environments}
                folders={previewFolders}
                repoFullName={repoFullName}
                selectedId={selectedEnv?.id ?? null}
                onSelect={selectEnv}
                onSave={persistPreviewEnvironments}
                onSaveFolders={persistPreviewFolders}
                onAddBranch={addBranch}
                isSaving={
                  saveEnvironmentsMutation.isPending ||
                  saveFoldersMutation.isPending
                }
                variant="address"
              />
            }
            emptyState={
              !selectedIssueIsActive ? (
                <div className="h-full flex items-center justify-center p-6">
                  {configQuery.isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                  ) : (
                    <div className="w-full max-w-xl mx-auto flex flex-col gap-4">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10">
                          <GitBranch className="w-5 h-5 text-sky-300" />
                        </span>
                        <h2 className="text-heading-md font-semibold text-zinc-200">
                          Add a branch preview
                        </h2>
                        <p className="max-w-md text-body-xs text-zinc-500">
                          Pick a tracked Fly branch preview for this repo. It
                          will be saved with the repo preview environments.
                        </p>
                      </div>
                      <PreviewBranchEnvForm
                        repoFullName={repoFullName}
                        submitLabel="Add branch preview"
                        isSaving={saveEnvironmentsMutation.isPending}
                        onSubmit={addBranch}
                      />
                      {!hasExplicitEnvironments && (
                        <>
                          <div className="flex items-center gap-2 text-body-xs text-zinc-600">
                            <span className="h-px flex-1 bg-zinc-800" />
                            or
                            <span className="h-px flex-1 bg-zinc-800" />
                          </div>
                          <VibeDefaultPreviewField
                            value={defaultPreviewUrl}
                            onSave={async (url) => {
                              await saveDefaultPreviewMutation.mutateAsync(url);
                            }}
                            isSaving={saveDefaultPreviewMutation.isPending}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : selectedIssueNumber !== null ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                  {/* If the vault is locked, a Fly preview can never resolve —
                      say so (with the raw error) instead of a silent blank. */}
                  <VaultLockedBanner
                    className="max-w-md text-left"
                    feature="This blocks Fly previews — the dashboard can't read the repo's Fly token."
                  />
                  <p className="text-body-sm text-zinc-300">No preview yet</p>
                  <p className="max-w-md text-body-xs text-zinc-500">
                    Once a PR is opened for this issue, its preview will appear
                    here.
                  </p>
                  <VibeRunButton
                    issueNumber={selectedIssueNumber}
                    column={selectedTask?.column}
                    onDispatched={() =>
                      queryClient.invalidateQueries({
                        queryKey: ["kody-tasks"],
                      })
                    }
                  />
                </div>
              ) : null
            }
          />

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
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10">
              <ListChecks className="w-4 h-4 text-emerald-300" />
            </span>
            <span className="text-body-sm font-medium">Open issues</span>
          </button>
        }
      />
    </div>
  );
}
