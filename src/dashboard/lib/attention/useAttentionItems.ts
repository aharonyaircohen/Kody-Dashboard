/**
 * @fileType hook
 * @domain kody
 * @pattern attention-hook
 * @ai-summary Composes existing dashboard hooks into one AttentionItem list for
 *   the home page. React Query still owns fetching/caching; this hook only
 *   adapts and ranks the shared presentation model.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ciAttentionItems,
  activityAttentionItems,
  goalAttentionItems,
  healthAttentionItems,
  reportAttentionItems,
  sortAttentionItems,
  taskAttentionItems,
} from "./adapters";
import type { AttentionItem, AttentionSection } from "./types";
import { getStoredAuth } from "../api";
import { useKodyTasks } from "../hooks";
import { useActivityLog } from "../hooks/useActivityLog";
import {
  useAbortTask,
  useCreateFixCITask,
  useRerunCIRun,
  useRetryTask,
} from "../hooks/useDashboardActions";
import { useDefaultBranchCI } from "../hooks/useDefaultBranchCI";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useHealth } from "../hooks/useHealth";
import { useManagedGoals } from "../hooks/useManagedGoals";
import { useReports } from "../hooks/useReports";

const DISMISS_STORAGE_KEY = "kody.attention.dismissed";
const DISMISS_TTL_MS = 4 * 60 * 60 * 1000;

type DismissMap = Record<string, string>;

function readDismissed(): DismissMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: DismissMap = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "string") out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function writeDismissed(map: DismissMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Local dismiss is convenience only; the item remains available after reload.
  }
}

function useDismissedAttention(): [DismissMap, (id: string) => void] {
  const [dismissed, setDismissed] = useState<DismissMap>({});

  useEffect(() => {
    setDismissed(readDismissed());
    function onStorage(event: StorageEvent) {
      if (event.key === DISMISS_STORAGE_KEY) setDismissed(readDismissed());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: new Date().toISOString() };
      writeDismissed(next);
      return next;
    });
  }, []);

  return [dismissed, dismiss];
}

function filterDismissed(items: AttentionItem[], dismissed: DismissMap) {
  const now = Date.now();
  return items.filter((item) => {
    const dismissedAt = dismissed[item.id];
    if (!dismissedAt) return true;
    return now - Date.parse(dismissedAt) >= DISMISS_TTL_MS;
  });
}

export interface AttentionItemsResult {
  items: AttentionItem[];
  bySection: Record<AttentionSection, AttentionItem[]>;
  isLoading: boolean;
  dataUpdatedAt: number;
  dismiss: (id: string) => void;
}

export function useAttentionItems(): AttentionItemsResult {
  const { githubUser } = useGitHubIdentity();
  const retryTask = useRetryTask(githubUser?.login);
  const abortTask = useAbortTask(githubUser?.login);
  const rerunCI = useRerunCIRun();
  const createFixCI = useCreateFixCITask();
  const [dismissed, dismiss] = useDismissedAttention();

  const tasks = useKodyTasks({ refetchInterval: "auto" });
  const reports = useReports();
  const health = useHealth();
  const ci = useDefaultBranchCI();
  const goals = useManagedGoals();
  const activity = useActivityLog(!!getStoredAuth());

  const items = useMemo(() => {
    const next: AttentionItem[] = [
      ...taskAttentionItems(tasks.data ?? [], {
        onRetry: (issueNumber) => retryTask.mutate(issueNumber),
        retryPending: retryTask.isPending,
        onStop: (issueNumber) => abortTask.mutate(issueNumber),
        stopPending: abortTask.isPending,
        onDismiss: dismiss,
      }),
      ...ciAttentionItems(ci.data, {
        onRerun: (runId) => rerunCI.mutate(runId),
        rerunPending: rerunCI.isPending,
        onCreateFixTask:
          ci.data?.state === "failure" && ci.data.latestRun
            ? () =>
                createFixCI.mutate({
                  ci: ci.data!,
                  runId: ci.data!.latestRun!.id,
                  runName: ci.data!.latestRun!.name,
                  runUrl: ci.data!.latestRun!.html_url,
                })
            : undefined,
        createFixPending: createFixCI.isPending,
        onDismiss: dismiss,
      }),
      ...reportAttentionItems(reports.data ?? [], dismiss),
      ...healthAttentionItems(health.data, dismiss),
      ...goalAttentionItems(goals.data ?? []),
      ...activityAttentionItems(activity.data?.entries ?? []),
    ];

    return sortAttentionItems(filterDismissed(next, dismissed));
  }, [
    abortTask,
    activity.data,
    ci.data,
    createFixCI,
    dismiss,
    dismissed,
    goals.data,
    health.data,
    reports.data,
    rerunCI,
    retryTask,
    tasks.data,
  ]);

  const bySection = useMemo<Record<AttentionSection, AttentionItem[]>>(
    () => ({
      needs_you: items
        .filter((item) => item.section === "needs_you")
        .slice(0, 8),
      running: items.filter((item) => item.section === "running").slice(0, 6),
      done: items.filter((item) => item.section === "done").slice(0, 6),
      quiet: items.filter((item) => item.section === "quiet").slice(0, 6),
    }),
    [items],
  );

  return {
    items,
    bySection,
    isLoading:
      tasks.isLoading ||
      reports.isLoading ||
      health.isLoading ||
      ci.isLoading ||
      goals.isLoading ||
      activity.isLoading,
    dataUpdatedAt: Math.max(
      tasks.dataUpdatedAt,
      reports.dataUpdatedAt,
      health.dataUpdatedAt,
      ci.dataUpdatedAt,
      goals.dataUpdatedAt,
      activity.dataUpdatedAt,
    ),
    dismiss,
  };
}
