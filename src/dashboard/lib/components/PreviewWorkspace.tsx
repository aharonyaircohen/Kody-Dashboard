/**
 * @fileType component
 * @domain preview
 * @pattern preview-workspace
 * @ai-summary Standalone `/preview` page — the full Vibe preview (iframe, Web/
 *   Admin views, device sizes, element inspector → chat) detached from any task.
 *   Adds a named-environment switcher (Production / Staging / Dev …) whose list
 *   lives in state repo `dashboard.json`. The shared chat rail provides the composer
 *   the inspector injects into, so element-pick + screenshot work here too.
 *   The shell renders the page header above this; we just fill the pane.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MonitorPlay, Upload } from "lucide-react";

import { useChatScope } from "./ChatRailShell";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";
import { selectionPath } from "../selection-routing";
import { PreviewPane } from "./PreviewPane";
import { PreviewEnvSwitcher } from "./PreviewEnvSwitcher";
import { PreviewBranchEnvForm } from "./PreviewBranchEnvForm";
import { PreviewFileUploadButton } from "./PreviewFileUploadButton";
import {
  addBranchPreviewEnvironment,
  addEnvironment,
  addRepoViewEnvironment,
  expiredUploads,
  isFlyBranchEnvironment,
  normalizeBranchName,
  normalizeEnvUrl,
  repoViewIdFromPath,
  resolveEnvironments,
  setEnvExpiry,
  STATIC_PREVIEW_TTL_MS,
  type PreviewEnvironment,
} from "../preview-environments";
import {
  fetchBranchPreviews,
  mintBranchPreviewUrl,
} from "../previews/branch-preview-client";
import { destroyStaticPreview } from "../previews/static-preview-client";
import {
  deleteRepoView,
  mintRepoViewTicket,
  tokenizeRepoViewUrl,
  uploadRepoView,
} from "../previews/repo-view-client";
import { createUploadContext } from "../previews/upload-context";
import {
  fetchDashboardConfig,
  saveDashboardConfig,
} from "../dashboard-config/client";
import { previewChatContextBlock } from "../chat/preview-context";
import {
  getStoredAuth,
  RateLimitError,
  NoTokenError,
  SessionExpiredError,
} from "../api";

function selectionKey(owner: string, repo: string): string {
  return `kody.previewEnv.${owner}/${repo}`;
}

function repoViewUrlLooksLikePdf(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, "http://kody.local");
    return parsed.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(url);
  }
}

function isTransientRepoViewUrl(url: string): boolean {
  try {
    const parsed = new URL(
      url,
      typeof window === "undefined"
        ? "http://kody.local"
        : window.location.origin,
    );
    return parsed.pathname.startsWith("/api/kody/views/_t/");
  } catch {
    return url.startsWith("/api/kody/views/_t/");
  }
}

function labelFromPreviewUrl(url: string): string {
  try {
    const parsed = new URL(
      url,
      typeof window === "undefined"
        ? "http://kody.local"
        : window.location.origin,
    );
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return host || "Saved URL";
    const segments = path.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const suffix = last.replace(/[-_]+/g, " ").trim();
    return suffix ? `${host} ${suffix}` : host || "Saved URL";
  } catch {
    return "Saved URL";
  }
}

export function PreviewWorkspace({
  selectedId = null,
}: {
  selectedId?: string | null;
} = {}) {
  const router = useRouter();
  const scopedHref = useRepoScopedHref();
  const queryClient = useQueryClient();
  const { githubUser } = useGitHubIdentity();
  const { setComposerInjection, setAttachmentInjection, setPreviewContext } =
    useChatScope();
  const owner = getStoredAuth()?.owner ?? "";
  const repo = getStoredAuth()?.repo ?? "";
  const repoFullName = owner && repo ? `${owner}/${repo}` : "";

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

  const environments = useMemo(
    () => resolveEnvironments(configQuery.data?.config),
    [configQuery.data],
  );
  const configLoaded = configQuery.data !== undefined;

  // Remember the last-picked environment per repo so /preview restores it.
  const [storedId, setStoredId] = useState<string | null>(null);
  const pendingSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!owner || !repo) return;
    try {
      const stored = window.localStorage.getItem(selectionKey(owner, repo));
      if (stored) setStoredId(stored);
    } catch {
      /* private mode — ignore */
    }
  }, [owner, repo]);

  // Keep selection valid: default to the stored env or first env when none
  // chosen, or when the chosen one was removed.
  useEffect(() => {
    if (configQuery.isLoading || !configLoaded) return;
    if (environments.length === 0) {
      if (selectedId) router.replace(scopedHref("/preview"));
      return;
    }
    const pendingSelectedId = pendingSelectionRef.current;
    if (pendingSelectedId) {
      const pendingExists = environments.some(
        (e) => e.id === pendingSelectedId,
      );
      if (pendingExists && selectedId !== pendingSelectedId) {
        router.replace(
          scopedHref(selectionPath("/preview", pendingSelectedId)),
        );
        return;
      }
      if (!pendingExists && selectedId !== pendingSelectedId) {
        return;
      }
    }
    if (selectedId && environments.some((e) => e.id === selectedId)) {
      if (pendingSelectedId === selectedId) {
        pendingSelectionRef.current = null;
      }
      try {
        window.localStorage.setItem(selectionKey(owner, repo), selectedId);
      } catch {
        /* ignore */
      }
      return;
    }
    if (selectedId && pendingSelectedId === selectedId) {
      return;
    }
    const fallback =
      environments.find((env) => env.id === storedId) ?? environments[0]!;
    router.replace(scopedHref(selectionPath("/preview", fallback.id)));
  }, [
    configLoaded,
    configQuery.isLoading,
    environments,
    owner,
    repo,
    router,
    scopedHref,
    selectedId,
    storedId,
  ]);

  const selectEnv = (env: PreviewEnvironment): void => {
    if (!environments.some((current) => current.id === env.id)) {
      pendingSelectionRef.current = env.id;
    } else {
      pendingSelectionRef.current = null;
    }
    setStoredId(env.id);
    try {
      window.localStorage.setItem(selectionKey(owner, repo), env.id);
    } catch {
      /* ignore */
    }
    router.push(scopedHref(selectionPath("/preview", env.id)));
  };

  const selectedEnv =
    environments.find((e) => e.id === selectedId) ?? environments[0] ?? null;
  const selectedFlyBranch = isFlyBranchEnvironment(selectedEnv)
    ? selectedEnv.flyBranch
    : null;
  const selectedFlyBranchMatchesRepo =
    !!selectedFlyBranch && selectedFlyBranch.repo === repoFullName;
  const repoViewId = selectedFlyBranch
    ? null
    : repoViewIdFromPath(selectedEnv?.repoViewPath);
  const isRepoViewPdf =
    !!repoViewId && repoViewUrlLooksLikePdf(selectedEnv?.url);
  const branchPreviewsQuery = useQuery({
    queryKey: ["kody-branch-previews", owner, repo],
    queryFn: fetchBranchPreviews,
    enabled: !!selectedFlyBranchMatchesRepo && !!owner && !!repo,
    staleTime: 15 * 60 * 1000,
    refetchInterval: 3 * 60 * 60 * 1000,
    retry: false,
  });
  const resolvedBranchPreview = selectedFlyBranch
    ? branchPreviewsQuery.data?.previews.find(
        (preview) => preview.branch === selectedFlyBranch.branch,
      )
    : null;
  const branchPreviewTicketQuery = useQuery({
    queryKey: [
      "kody-branch-preview-ticket",
      selectedFlyBranch?.repo,
      selectedFlyBranch?.branch,
    ],
    queryFn: () =>
      mintBranchPreviewUrl(selectedFlyBranch!.repo, selectedFlyBranch!.branch),
    enabled: !!selectedFlyBranchMatchesRepo && !!owner && !!repo,
    staleTime: 15 * 60 * 1000,
    retry: false,
  });
  const signedBranchPreviewUrl = branchPreviewTicketQuery.data?.url ?? null;
  const viewTicketQuery = useQuery({
    queryKey: ["kody-repo-view-ticket", owner, repo, repoViewId],
    queryFn: () => mintRepoViewTicket(repoViewId!),
    enabled: !!repoViewId && !!owner && !!repo,
    staleTime: 15 * 60 * 1000,
    retry: false,
  });
  const baseUrl = selectedFlyBranch
    ? (resolvedBranchPreview?.url ?? signedBranchPreviewUrl)
    : selectedEnv?.url && repoViewId
      ? viewTicketQuery.data
        ? tokenizeRepoViewUrl(selectedEnv.url, viewTicketQuery.data.token)
        : null
      : (selectedEnv?.url ?? null);
  const branchPreviewIsResolving =
    !!selectedFlyBranchMatchesRepo &&
    !resolvedBranchPreview?.url &&
    !signedBranchPreviewUrl &&
    (branchPreviewsQuery.isLoading ||
      branchPreviewsQuery.isFetching ||
      branchPreviewTicketQuery.isLoading ||
      branchPreviewTicketQuery.isFetching ||
      resolvedBranchPreview?.state === "pending" ||
      resolvedBranchPreview?.state === "building" ||
      resolvedBranchPreview?.state === "starting");

  useEffect(() => {
    setPreviewContext(previewChatContextBlock(selectedEnv));
    return () => setPreviewContext(null);
  }, [selectedEnv, setPreviewContext]);

  useEffect(() => {
    if (viewTicketQuery.error) {
      toast.error(
        viewTicketQuery.error instanceof Error
          ? viewTicketQuery.error.message
          : "Failed to open repo-backed view",
      );
    }
  }, [viewTicketQuery.error]);

  useEffect(() => {
    const error = branchPreviewsQuery.error ?? branchPreviewTicketQuery.error;
    if (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to open branch preview",
      );
    }
  }, [branchPreviewsQuery.error, branchPreviewTicketQuery.error]);

  const saveMutation = useMutation({
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
        err instanceof Error ? err.message : "Failed to save environments",
      );
    },
  });

  const persist = async (next: PreviewEnvironment[]): Promise<void> => {
    await saveMutation.mutateAsync(next);
  };

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
    await persist(next);
    const created = next[next.length - 1];
    if (created) selectEnv(created);
    toast.success(`Saved "${created?.label ?? cleanBranch}"`);
  };

  const saveCurrentUrlAsEnvironment = async (url: string): Promise<void> => {
    if (isTransientRepoViewUrl(url)) {
      toast.info("Repo-backed views are already saved as environments");
      return;
    }
    const normalizedUrl = normalizeEnvUrl(url);
    if (!normalizedUrl) {
      toast.error("Couldn't save current URL");
      return;
    }
    const existing = environments.find(
      (env) => (env.url ? normalizeEnvUrl(env.url) : null) === normalizedUrl,
    );
    if (existing) {
      selectEnv(existing);
      toast.info(`"${existing.label}" is already saved`);
      return;
    }
    const next = addEnvironment(
      environments,
      labelFromPreviewUrl(normalizedUrl),
      normalizedUrl,
    );
    const created = next[next.length - 1];
    if (!created || created.url !== normalizedUrl) {
      toast.error("Couldn't save current URL");
      return;
    }
    await persist(next);
    selectEnv(created);
    toast.success(`Saved "${created.label}"`);
  };

  // Upload file(s) into the state repo under views/<id> and
  // add the dashboard-served URL as a named preview environment.
  const uploadFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    try {
      const uploadContext =
        files.length === 1 ? await createUploadContext(files[0]!) : undefined;
      const res = await uploadRepoView(files);
      const next = addRepoViewEnvironment(
        environments,
        res.name,
        res.url,
        res.repoPath,
        uploadContext,
      );
      await persist(next);
      const created = next[next.length - 1];
      if (created) selectEnv(created);
      toast.success(
        files.length === 1
          ? `Saved "${res.name}" to ${res.repoPath}`
          : `Saved ${files.length} files to ${res.repoPath}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      throw err;
    }
  };

  const removeStatic = async (staticId: string): Promise<void> => {
    try {
      await destroyStaticPreview(staticId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to destroy preview",
      );
    }
  };

  const removeRepoView = async (repoViewPath: string): Promise<void> => {
    try {
      await deleteRepoView(repoViewPath);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete stored view",
      );
    }
  };

  // Push an uploaded preview's expiry out by another full TTL from now.
  const extendEnv = async (id: string): Promise<void> => {
    const next = setEnvExpiry(
      environments,
      id,
      Date.now() + STATIC_PREVIEW_TTL_MS,
    );
    await persist(next);
    toast.success("Extended — 7 more days");
  };

  // Lazy reaper: on load, destroy + drop any uploaded preview past its expiry.
  // No cron needed — cleanup happens whenever someone opens /preview. Runs
  // once per mount (guarded) so it doesn't loop on the persist-driven refetch.
  const reapedRef = useRef(false);
  useEffect(() => {
    if (configQuery.isLoading || reapedRef.current) return;
    const expired = expiredUploads(environments, Date.now());
    if (expired.length === 0) return;
    reapedRef.current = true;
    void (async () => {
      await Promise.allSettled(
        expired.map((e) =>
          e.staticId ? destroyStaticPreview(e.staticId) : Promise.resolve(),
        ),
      );
      const expiredIds = new Set(expired.map((e) => e.id));
      await persist(environments.filter((e) => !expiredIds.has(e.id)));
    })();
    // persist updates the cache → environments changes, but reapedRef stops a
    // re-run; depend on the loading flag + list so we fire once data is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQuery.isLoading, environments]);

  return (
    <section className="relative flex-1 min-w-0 min-h-0 flex flex-col">
      <PreviewPane
        baseUrl={baseUrl}
        isResolving={
          (!!repoViewId && viewTicketQuery.isLoading) ||
          branchPreviewIsResolving
        }
        owner={owner}
        repo={repo}
        showBrowserChrome
        iframeSandbox={
          isRepoViewPdf
            ? null
            : repoViewId
              ? "allow-scripts allow-forms allow-popups allow-downloads"
              : undefined
        }
        onComposerInjection={setComposerInjection}
        onAttachmentInjection={setAttachmentInjection}
        onSaveCurrentUrl={saveCurrentUrlAsEnvironment}
        isSavingCurrentUrl={saveMutation.isPending}
        leadingToolbar={
          environments.length > 0 ? (
            <PreviewEnvSwitcher
              environments={environments}
              repoFullName={repoFullName}
              selectedId={selectedEnv?.id ?? null}
              onSelect={selectEnv}
              onSave={persist}
              onAddBranch={addBranch}
              onUpload={uploadFiles}
              onRemoveStatic={removeStatic}
              onRemoveRepoView={removeRepoView}
              onExtend={extendEnv}
              isSaving={saveMutation.isPending}
              variant="address"
            />
          ) : null
        }
        emptyState={
          configQuery.isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <div className="w-full max-w-md flex flex-col gap-4">
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10">
                    <MonitorPlay className="w-5 h-5 text-sky-300" />
                  </span>
                  <h2 className="text-sm font-semibold text-zinc-200">
                    Add a branch preview
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Pick a tracked Fly branch preview for this repo. Stored at{" "}
                    <code className="text-zinc-400">state dashboard.json</code>.
                  </p>
                </div>
                <PreviewBranchEnvForm
                  repoFullName={repoFullName}
                  submitLabel="Add branch preview"
                  isSaving={saveMutation.isPending}
                  onSubmit={addBranch}
                />
                <div className="flex items-center gap-2 text-[11px] text-zinc-600">
                  <span className="h-px flex-1 bg-zinc-800" />
                  or
                  <span className="h-px flex-1 bg-zinc-800" />
                </div>
                <PreviewFileUploadButton
                  onFiles={(files) => void uploadFiles(files)}
                  className="items-center justify-center rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload view files
                </PreviewFileUploadButton>
              </div>
            </div>
          )
        }
      />
    </section>
  );
}
