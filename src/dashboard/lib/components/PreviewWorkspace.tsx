/**
 * @fileType component
 * @domain preview
 * @pattern preview-workspace
 * @ai-summary Standalone `/preview` page — the full Vibe preview (iframe, Web/
 *   Admin views, device sizes, element inspector → chat) detached from any task.
 *   Adds a named-environment switcher (Production / Staging / Dev …) whose list
 *   lives in `.kody/dashboard.json`. The shared chat rail provides the composer
 *   the inspector injects into, so element-pick + screenshot work here too.
 *   The shell renders the page header above this; we just fill the pane.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MonitorPlay, Upload } from "lucide-react";

import { useChatScope } from "./ChatRailShell";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { PreviewPane } from "./PreviewPane";
import { PreviewEnvSwitcher } from "./PreviewEnvSwitcher";
import { PreviewEnvForm } from "./PreviewEnvForm";
import {
  addEnvironment,
  addUploadedEnvironment,
  expiredUploads,
  resolveEnvironments,
  setEnvExpiry,
  STATIC_PREVIEW_TTL_MS,
  type PreviewEnvironment,
} from "../preview-environments";
import {
  destroyStaticPreview,
  uploadStaticPreview,
} from "../previews/static-preview-client";
import {
  fetchDashboardConfig,
  saveDashboardConfig,
} from "../dashboard-config/client";
import { getStoredAuth, RateLimitError, NoTokenError, SessionExpiredError } from "../api";

function selectionKey(owner: string, repo: string): string {
  return `kody.previewEnv.${owner}/${repo}`;
}

export function PreviewWorkspace() {
  const queryClient = useQueryClient();
  const { githubUser } = useGitHubIdentity();
  const { setComposerInjection, setAttachmentInjection } = useChatScope();

  const owner = getStoredAuth()?.owner ?? "";
  const repo = getStoredAuth()?.repo ?? "";

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

  // Remember the last-picked environment per repo so a refresh restores it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!owner || !repo) return;
    try {
      const stored = window.localStorage.getItem(selectionKey(owner, repo));
      if (stored) setSelectedId(stored);
    } catch {
      /* private mode — ignore */
    }
  }, [owner, repo]);

  // Keep selection valid: default to the first env when none chosen or the
  // chosen one was removed.
  useEffect(() => {
    if (environments.length === 0) return;
    const exists = environments.some((e) => e.id === selectedId);
    if (!exists) setSelectedId(environments[0]!.id);
  }, [environments, selectedId]);

  const selectEnv = (env: PreviewEnvironment): void => {
    setSelectedId(env.id);
    try {
      window.localStorage.setItem(selectionKey(owner, repo), env.id);
    } catch {
      /* ignore */
    }
  };

  const selectedEnv =
    environments.find((e) => e.id === selectedId) ?? environments[0] ?? null;
  const baseUrl = selectedEnv?.url ?? null;

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

  const addFirst = async (label: string, url: string): Promise<void> => {
    const next = addEnvironment(environments, label, url);
    await persist(next);
    const created = next[next.length - 1];
    if (created) selectEnv(created);
  };

  // Upload a file → boot a Fly static preview → add it as an environment and
  // select it. The environment carries the staticId so removal tears the Fly
  // app down (see removeStatic + PreviewEnvSwitcher.handleRemove), and an
  // expiresAt so it auto-reaps after the TTL even if nobody deletes it.
  const uploadFile = async (file: File): Promise<void> => {
    try {
      const res = await uploadStaticPreview(file);
      const next = addUploadedEnvironment(
        environments,
        res.name,
        res.url,
        res.id,
        Date.now() + STATIC_PREVIEW_TTL_MS,
      );
      await persist(next);
      const created = next[next.length - 1];
      if (created) selectEnv(created);
      toast.success(`Serving "${res.name}" — ready in a few seconds`);
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

  // Push an uploaded preview's expiry out by another full TTL from now.
  const extendEnv = async (id: string): Promise<void> => {
    const next = setEnvExpiry(environments, id, Date.now() + STATIC_PREVIEW_TTL_MS);
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

  const emptyUploadRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="relative flex-1 min-w-0 min-h-0 flex flex-col">
      <PreviewPane
        baseUrl={baseUrl}
        isResolving={false}
        owner={owner}
        repo={repo}
        onComposerInjection={setComposerInjection}
        onAttachmentInjection={setAttachmentInjection}
        leadingToolbar={
          environments.length > 0 ? (
            <PreviewEnvSwitcher
              environments={environments}
              selectedId={selectedEnv?.id ?? null}
              onSelect={selectEnv}
              onSave={persist}
              onAdd={addFirst}
              onUpload={uploadFile}
              onRemoveStatic={removeStatic}
              onExtend={extendEnv}
              isSaving={saveMutation.isPending}
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
                    Add a preview environment
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Point Kody at a running deployment — Production, Staging,
                    Dev, or any URL. Add more later from the switcher. Stored per
                    repo at{" "}
                    <code className="text-zinc-400">.kody/dashboard.json</code>.
                  </p>
                </div>
                <PreviewEnvForm
                  submitLabel="Add environment"
                  isSaving={saveMutation.isPending}
                  onSubmit={addFirst}
                />
                <div className="flex items-center gap-2 text-[11px] text-zinc-600">
                  <span className="h-px flex-1 bg-zinc-800" />
                  or
                  <span className="h-px flex-1 bg-zinc-800" />
                </div>
                <input
                  ref={emptyUploadRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadFile(f);
                    if (emptyUploadRef.current) emptyUploadRef.current.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => emptyUploadRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload a file (HTML, PDF, image…)
                </button>
              </div>
            </div>
          )
        }
      />
    </section>
  );
}
