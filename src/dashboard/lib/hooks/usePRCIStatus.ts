/**
 * @fileType hook
 * @domain kody
 * @pattern usePRCIStatus
 * @ai-summary Derive PR CI status from the cached tasks list — no per-PR fetch.
 */
"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { KodyTask, TasksResponse } from "../types";

interface PRCIStatusResult {
  ciStatus: "pending" | "success" | "failure" | "running";
  mergeable: boolean;
  hasConflicts: boolean;
}

type TaskCacheData = KodyTask[] | TasksResponse | undefined | null;

function cachedTasks(data: TaskCacheData): KodyTask[] | null {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as TasksResponse).tasks)) {
    return (data as TasksResponse).tasks;
  }
  return null;
}

export function findCachedPRCIStatus(
  queries: Array<readonly [unknown, TaskCacheData]>,
  prNumber: number,
): PRCIStatusResult | undefined {
  for (const [, cached] of queries) {
    const tasks = cachedTasks(cached);
    if (!tasks) continue;
    const task = tasks.find((t) => t.associatedPR?.number === prNumber);
    const pr = task?.associatedPR;
    if (pr) {
      return {
        ciStatus: pr.ciStatus ?? "pending",
        mergeable: pr.mergeable ?? false,
        hasConflicts: pr.hasConflicts ?? false,
      };
    }
  }
  return undefined;
}

/**
 * Returns the CI status / mergeability for a PR, sourced from whatever
 * `useKodyTasks` query is already cached. CI rollup is folded into the bulk
 * `fetchOpenPRs` GraphQL query (see github-client), so we no longer need a
 * per-PR `/api/kody/prs/status` poll — every tasks-list refresh carries the
 * same data for free.
 *
 * The hook subscribes to React Query's cache so it re-renders when any tasks
 * query updates, but it never triggers a fetch itself: the dashboard's main
 * `useKodyTasks` is the sole owner of the polling cadence.
 */
export function usePRCIStatus(prNumber: number | undefined) {
  const queryClient = useQueryClient();
  const [, force] = useState(0);

  useEffect(() => {
    if (!prNumber) return;
    const unsub = queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (Array.isArray(key) && key[0] === "kody-tasks") {
        force((n) => n + 1);
      }
    });
    return unsub;
  }, [queryClient, prNumber]);

  let data: PRCIStatusResult | undefined;
  if (prNumber) {
    const queries = queryClient.getQueriesData<TaskCacheData>({
      queryKey: ["kody-tasks"],
    });
    data = findCachedPRCIStatus(queries, prNumber);
  }

  return { data, isLoading: !data && !!prNumber, isError: false };
}
