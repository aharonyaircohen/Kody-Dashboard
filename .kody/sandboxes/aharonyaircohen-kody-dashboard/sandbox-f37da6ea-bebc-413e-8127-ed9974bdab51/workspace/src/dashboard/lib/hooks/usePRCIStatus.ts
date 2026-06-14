/**
 * @fileType hook
 * @domain kody
 * @pattern usePRCIStatus
 * @ai-summary Derive PR CI status from the cached tasks list — no per-PR fetch.
 */
"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { KodyTask } from "../types";

interface PRCIStatusResult {
  ciStatus: "pending" | "success" | "failure" | "running";
  mergeable: boolean;
  hasConflicts: boolean;
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
    const queries = queryClient.getQueriesData<KodyTask[]>({
      queryKey: ["kody-tasks"],
    });
    for (const [, tasks] of queries) {
      if (!tasks) continue;
      const task = tasks.find((t) => t.associatedPR?.number === prNumber);
      const pr = task?.associatedPR;
      if (pr) {
        data = {
          ciStatus: pr.ciStatus ?? "pending",
          mergeable: pr.mergeable ?? false,
          hasConflicts: pr.hasConflicts ?? false,
        };
        break;
      }
    }
  }

  return { data, isLoading: !data && !!prNumber, isError: false };
}
