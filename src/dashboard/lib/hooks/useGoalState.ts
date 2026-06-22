/**
 * @fileType hook
 * @domain kody
 * @pattern goal-runtime-state
 * @ai-summary React Query hooks for a single goal's runtime state file
 *   (`.kody/goals/instances/<id>/state.json`). One query per goal id; cache is
 *   conservative (60s stale) since states change rarely. The mutation
 *   invalidates only the affected goal's state, not the goal list.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  goalsApi,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import type { GoalRunState } from "../goal-state";

export const goalStateQueryKeys = {
  one: (id: string) => ["kody-goals", "state", id] as const,
};

export function useGoalState(goalId: string | null | undefined) {
  return useQuery({
    queryKey: goalStateQueryKeys.one(goalId ?? "__missing__"),
    queryFn: () => {
      if (!goalId) throw new Error("goalId is required");
      return goalsApi.getState(goalId);
    },
    enabled: !!goalId && !!getStoredAuth(),
    staleTime: 60_000,
    // While the goal is active, refresh once a minute so the "ticked Xm ago"
    // indicator stays honest. Most polls hit GitHub's ETag cache (304 → free).
    // Don't poll when state is null/done/paused — nothing changes there.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && data.state === "active" ? 60_000 : false;
    },
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useSetGoalState(goalId: string, actorLogin?: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      state: "active" | "paused";
      pausedReason?: string;
    }): Promise<GoalRunState> => {
      return goalsApi.setState(goalId, {
        state: input.state,
        pausedReason: input.pausedReason,
        ...(actorLogin ? { actorLogin } : {}),
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(goalStateQueryKeys.one(goalId), next);
      toast.success(
        next.state === "active" ? "Goal runner started" : "Goal runner paused",
      );
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Failed to update goal state";
      toast.error(msg);
    },
  });
}

/**
 * Toggle "let Kody manage this goal end-to-end" — the `goal-manager`
 * agent decomposes it, QA-verifies the journey, recovers stalls, and
 * leaves one open deliverable PR. Enabling a never-started goal starts it.
 */
export function useManageGoal(goalId: string, actorLogin?: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (managed: boolean): Promise<GoalRunState> => {
      return goalsApi.manage(goalId, {
        managed,
        ...(actorLogin ? { actorLogin } : {}),
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(goalStateQueryKeys.one(goalId), next);
      toast.success(
        next.managed
          ? "Kody will manage this goal end-to-end"
          : "Kody management disabled for this goal",
      );
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Failed to update management";
      toast.error(msg);
    },
  });
}

/**
 * Approve the manual merge of a parked goal. The engine then runs its
 * existing finalize once (squash-merge the leaf, close the stack, →done).
 */
export function useMergeGoal(goalId: string, actorLogin?: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<GoalRunState> => {
      return goalsApi.merge(goalId, {
        ...(actorLogin ? { actorLogin } : {}),
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(goalStateQueryKeys.one(goalId), next);
      toast.success("Merging goal — engine is finalizing the PRs");
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to merge goal";
      toast.error(msg);
    },
  });
}
