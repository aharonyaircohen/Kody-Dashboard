/**
 * @fileType hook
 * @domain kody
 * @pattern managed-goals
 * @ai-summary React Query hooks for engine managed goals.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  kodyApi,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import type {
  CreateManagedGoalInput,
  ManagedGoalRecord,
  UpdateManagedGoalInput,
} from "../managed-goals";

export const managedGoalQueryKeys = {
  list: ["kody-managed-goals"] as const,
};

type ManagedGoalStateMutationInput = {
  id: string;
  state: "inactive" | "active" | "paused";
  pausedReason?: string;
};

type ManagedGoalStateMutationContext = {
  previous: ManagedGoalRecord[];
};

type ManagedGoalDeleteMutationContext = {
  previous: ManagedGoalRecord[];
};

function managedGoalMatchesId(goal: ManagedGoalRecord, id: string): boolean {
  const sourceTemplate =
    typeof goal.state.sourceTemplate === "string"
      ? goal.state.sourceTemplate
      : "";
  return goal.id === id || sourceTemplate === id;
}

function patchManagedGoalState(
  goals: ManagedGoalRecord[] | undefined,
  id: string,
  state: "inactive" | "active" | "paused",
  pausedReason?: string,
): ManagedGoalRecord[] | undefined {
  if (!goals) return goals;
  return goals.map((goal) => {
    if (!managedGoalMatchesId(goal, id)) return goal;
    return {
      ...goal,
      state: {
        ...goal.state,
        state,
        ...(state === "paused" && pausedReason ? { pausedReason } : {}),
        ...(state !== "paused" ? { pausedReason: undefined } : {}),
      },
    };
  });
}

function mergeManagedGoalRecord(
  goals: ManagedGoalRecord[] | undefined,
  updated: ManagedGoalRecord,
): ManagedGoalRecord[] {
  if (!goals) return [updated];
  let matched = false;
  const next = goals.map((goal) => {
    if (!managedGoalMatchesId(goal, updated.id)) return goal;
    matched = true;
    return {
      ...goal,
      ...updated,
      id: goal.id,
      state: {
        ...goal.state,
        ...updated.state,
      },
    };
  });
  return matched
    ? next
    : [...goals, updated].sort((a, b) => a.id.localeCompare(b.id));
}

export function useManagedGoals() {
  return useQuery({
    queryKey: managedGoalQueryKeys.list,
    queryFn: () => kodyApi.goals.listManaged(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useCreateManagedGoal() {
  const queryClient = useQueryClient();
  return useMutation<ManagedGoalRecord, Error, CreateManagedGoalInput>({
    mutationFn: (data) => kodyApi.goals.createManaged(data),
    onSuccess: (created) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(
        managedGoalQueryKeys.list,
        (prev) => {
          if (!prev) return [created];
          if (prev.some((goal) => goal.id === created.id)) return prev;
          return [...prev, created].sort((a, b) => a.id.localeCompare(b.id));
        },
      );
      queryClient.invalidateQueries({ queryKey: managedGoalQueryKeys.list });
      toast.success("Created");
    },
    onError: (error) => {
      toast.error("Failed to create item", { description: error.message });
    },
  });
}

export function useUpdateManagedGoal(id: string) {
  const queryClient = useQueryClient();
  return useMutation<ManagedGoalRecord, Error, UpdateManagedGoalInput>({
    mutationFn: (data) => kodyApi.goals.updateManaged(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(
        managedGoalQueryKeys.list,
        (prev) =>
          prev
            ? prev.map((goal) => (goal.id === updated.id ? updated : goal))
            : [updated],
      );
      queryClient.invalidateQueries({ queryKey: managedGoalQueryKeys.list });
      toast.success("Updated");
    },
    onError: (error) => {
      toast.error("Failed to update item", { description: error.message });
    },
  });
}

export function useDeleteManagedGoal() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string, ManagedGoalDeleteMutationContext>({
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: managedGoalQueryKeys.list });
      const previous =
        queryClient.getQueryData<ManagedGoalRecord[]>(
          managedGoalQueryKeys.list,
        ) ?? [];
      queryClient.setQueryData<ManagedGoalRecord[]>(
        managedGoalQueryKeys.list,
        (prev) => prev?.filter((goal) => !managedGoalMatchesId(goal, id)) ?? [],
      );
      return { previous };
    },
    mutationFn: (id) => kodyApi.goals.removeManaged(id),
    onSuccess: (_unused, id) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(
        managedGoalQueryKeys.list,
        (prev) => prev?.filter((goal) => !managedGoalMatchesId(goal, id)) ?? [],
      );
      toast.success("Deleted");
    },
    onError: (error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData<ManagedGoalRecord[]>(
          managedGoalQueryKeys.list,
          context.previous,
        );
      }
      toast.error("Failed to delete item", { description: error.message });
    },
  });
}

export function useRunManagedGoal() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: true; workflowId: string; ref: string; goal: ManagedGoalRecord },
    Error,
    string
  >({
    mutationFn: (id) => kodyApi.goals.runManaged(id),
    onSuccess: (result) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(
        managedGoalQueryKeys.list,
        (prev) => mergeManagedGoalRecord(prev, result.goal),
      );
      toast.success("Run started");
    },
    onError: (error) => {
      toast.error("Failed to start run", { description: error.message });
    },
  });
}

export function useSetManagedGoalState() {
  const queryClient = useQueryClient();
  return useMutation<
    ManagedGoalRecord,
    Error,
    ManagedGoalStateMutationInput,
    ManagedGoalStateMutationContext
  >({
    onMutate: async ({ id, state, pausedReason }) => {
      await queryClient.cancelQueries({ queryKey: managedGoalQueryKeys.list });
      const previous =
        queryClient.getQueryData<ManagedGoalRecord[]>(
          managedGoalQueryKeys.list,
        ) ?? [];
      queryClient.setQueryData<ManagedGoalRecord[]>(
        managedGoalQueryKeys.list,
        (prev) => patchManagedGoalState(prev, id, state, pausedReason),
      );
      return { previous };
    },
    mutationFn: ({ id, state, pausedReason }) =>
      kodyApi.goals.updateManaged(id, {
        state,
        ...(pausedReason ? { pausedReason } : {}),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(
        managedGoalQueryKeys.list,
        (prev) => mergeManagedGoalRecord(prev, updated),
      );
      toast.success(
        updated.state.state === "active"
          ? "Goal activated"
          : "Goal deactivated",
      );
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData<ManagedGoalRecord[]>(
          managedGoalQueryKeys.list,
          context.previous,
        );
      }
      toast.error("Failed to update item", { description: error.message });
    },
  });
}
