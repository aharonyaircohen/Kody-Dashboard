/**
 * @fileType hook
 * @domain kody
 * @pattern dashboard-action-hooks
 * @ai-summary Small React Query mutations powering the action buttons on the
 *   dashboard homepage: re-run a red default-branch CI run, create a Kody
 *   task seeded with the failing CI context, and retry a failed task.
 *   Plus a localStorage-backed `useAcknowledgeHealthSignal` for muting
 *   engine-health rows per device.
 *
 *   These compose existing endpoints where possible so the homepage is
 *   "one click away" from resolution without dragging the user into the
 *   task detail page for cheap operations.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { kodyApi, type DefaultBranchCI } from "../api";
import { useGitHubIdentity } from "./useGitHubIdentity";

export function useRerunCIRun() {
  return useMutation({
    mutationFn: (runId: number) => kodyApi.ci.rerun(runId),
    onSuccess: (data) => {
      toast.success("CI re-run started", {
        description: `Workflow run #${data.runId} is running again.`,
      });
    },
    onError: (error) => {
      toast.error("Re-run failed", { description: error.message });
    },
  });
}

/**
 * One-click "Fix CI" — opens a new Kody task seeded with the failing run's
 * context (branch, run name + URL, conclusion). Doesn't auto-run the task
 * (autoTrigger: false) so the user can review the body before the engine
 * starts. The issue gets a `from-ci-failure:<branch>` label so the lineage
 * is greppable in the tracker.
 */
export function useCreateFixCITask() {
  const { githubUser } = useGitHubIdentity();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ci,
      runId,
      runName,
      runUrl,
    }: {
      ci: DefaultBranchCI;
      runId: number;
      runName: string;
      runUrl: string;
    }) =>
      kodyApi.tasks.create({
        title: `Fix CI on ${ci.branch}: ${runName}`,
        body:
          `CI is red on \`${ci.branch}\`.\n\n` +
          `- Run: [#${runId} ${runName}](${runUrl})\n` +
          `- Conclusion: failure\n\n` +
          `Investigate the failing run, patch the cause, and re-run until green.`,
        mode: "full",
        labels: [`from-ci-failure:${ci.branch}`],
        actorLogin: githubUser?.login,
        autoTrigger: false,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
      toast.success("Task created", {
        description: `Opened #${created.issueNumber} to fix CI.`,
      });
    },
    onError: (error) => {
      toast.error("Could not create fix task", {
        description: error.message,
      });
    },
  });
}

export function useRetryTask(actorLogin?: string) {
  return useMutation({
    mutationFn: (issueNumber: number) =>
      kodyApi.tasks.rerun(issueNumber, actorLogin),
    onSuccess: (_data, issueNumber) => {
      toast.success("Task re-queued", {
        description: `#${issueNumber} is back in the pipeline.`,
      });
    },
    onError: (error) => {
      toast.error("Retry failed", { description: error.message });
    },
  });
}

export function useAbortTask(actorLogin?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (issueNumber: number) =>
      kodyApi.tasks.abort(issueNumber, actorLogin),
    onSuccess: (_data, issueNumber) => {
      queryClient.invalidateQueries({ queryKey: ["kody-tasks"] });
      toast.success("Task stopped", {
        description: `#${issueNumber} has been asked to stop.`,
      });
    },
    onError: (error) => {
      toast.error("Stop failed", { description: error.message });
    },
  });
}

const ACK_STORAGE_KEY = "kody.health.ack";

type AckMap = Record<string, string>;

function readAcks(): AckMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: AckMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeAcks(map: AckMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // private mode / quota — UI still works from in-memory state
  }
}

export interface UseAcknowledgeHealthSignalResult {
  acks: AckMap;
  isAcknowledged: (signalId: string) => boolean;
  acknowledge: (signalId: string) => void;
  unacknowledge: (signalId: string) => void;
  isHydrated: boolean;
}

export function useAcknowledgeHealthSignal(): UseAcknowledgeHealthSignalResult {
  const [acks, setAcks] = useState<AckMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setAcks(readAcks());
    setHydrated(true);
    function onStorage(e: StorageEvent) {
      if (e.key !== ACK_STORAGE_KEY) return;
      setAcks(readAcks());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const acknowledge = useCallback((signalId: string) => {
    setAcks((prev) => {
      if (prev[signalId]) return prev;
      const next = { ...prev, [signalId]: new Date().toISOString() };
      writeAcks(next);
      return next;
    });
  }, []);

  const unacknowledge = useCallback((signalId: string) => {
    setAcks((prev) => {
      if (!prev[signalId]) return prev;
      const next = { ...prev };
      delete next[signalId];
      writeAcks(next);
      return next;
    });
  }, []);

  const isAcknowledged = useCallback(
    (signalId: string) => Boolean(acks[signalId]),
    [acks],
  );

  return {
    acks,
    isAcknowledged,
    acknowledge,
    unacknowledge,
    isHydrated: hydrated,
  };
}
