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

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MonitorPlay } from "lucide-react";

import { useChatScope } from "./ChatRailShell";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { PreviewPane } from "./PreviewPane";
import { PreviewEnvSwitcher } from "./PreviewEnvSwitcher";
import { PreviewEnvForm } from "./PreviewEnvForm";
import {
  addEnvironment,
  resolveEnvironments,
  type PreviewEnvironment,
} from "../preview-environments";
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
              </div>
            </div>
          )
        }
      />
    </section>
  );
}
