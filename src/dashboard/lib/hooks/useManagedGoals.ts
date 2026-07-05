/**
 * @fileType hook
 * @domain kody
 * @pattern managed-goals
 * @ai-summary React Query hooks for engine managed goals.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { kodyApi, NoTokenError, SessionExpiredError } from "../api";
import {
  DEFAULT_KODY_STORE_REF,
  DEFAULT_KODY_STORE_REPO_URL,
  useAuth,
  type KodyAuth,
} from "../auth-context";
import type {
  CreateManagedGoalInput,
  ManagedGoalRecord,
  UpdateManagedGoalInput,
} from "../managed-goals";

export const managedGoalQueryKeys = {
  all: ["kody-managed-goals"] as const,
  list: (scope: ManagedGoalQueryScope | null) =>
    [...managedGoalQueryKeys.all, scope ?? "no-auth"] as const,
  runHistory: (scope: ManagedGoalQueryScope | null, id: string) =>
    [
      ...managedGoalQueryKeys.all,
      "run-history",
      scope ?? "no-auth",
      id,
    ] as const,
};

type ManagedGoalQueryScope = {
  owner: string;
  repo: string;
  storeRepoUrl: string;
  storeRef: string;
};

function managedGoalQueryScope(
  auth: KodyAuth | null,
): ManagedGoalQueryScope | null {
  if (!auth) return null;
  return {
    owner: auth.owner,
    repo: auth.repo,
    storeRepoUrl: auth.storeRepoUrl ?? DEFAULT_KODY_STORE_REPO_URL,
    storeRef: auth.storeRef ?? DEFAULT_KODY_STORE_REF,
  };
}

function useManagedGoalQueryKey() {
  const { auth } = useAuth();
  return {
    auth,
    queryKey: managedGoalQueryKeys.list(managedGoalQueryScope(auth)),
  };
}

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
  const { auth, queryKey } = useManagedGoalQueryKey();
  return useQuery({
    queryKey,
    queryFn: () => kodyApi.goals.listManaged(),
    enabled: !!auth,
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

export function useManagedGoalRunHistory(id: string, enabled = true) {
  const { auth } = useAuth();
  return useQuery({
    queryKey: managedGoalQueryKeys.runHistory(managedGoalQueryScope(auth), id),
    queryFn: () => kodyApi.goals.runHistory(id),
    enabled: !!auth && enabled && !!id,
    staleTime: 15_000,
    refetchInterval: enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
  });
}

export function useCreateManagedGoal() {
  const queryClient = useQueryClient();
  const { queryKey } = useManagedGoalQueryKey();
  return useMutation<ManagedGoalRecord, Error, CreateManagedGoalInput>({
    mutationFn: (data) => kodyApi.goals.createManaged(data),
    onSuccess: (created) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(queryKey, (prev) => {
        if (!prev) return [created];
        if (prev.some((goal) => goal.id === created.id)) return prev;
        return [...prev, created].sort((a, b) => a.id.localeCompare(b.id));
      });
      queryClient.invalidateQueries({ queryKey });
      toast.success("Created");
    },
    onError: (error) => {
      toast.error("Failed to create item", { description: error.message });
    },
  });
}

export function useUpdateManagedGoal(id: string) {
  const queryClient = useQueryClient();
  const { queryKey } = useManagedGoalQueryKey();
  return useMutation<ManagedGoalRecord, Error, UpdateManagedGoalInput>({
    mutationFn: (data) => kodyApi.goals.updateManaged(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(queryKey, (prev) =>
        prev
          ? prev.map((goal) => (goal.id === updated.id ? updated : goal))
          : [updated],
      );
      queryClient.invalidateQueries({ queryKey });
      toast.success("Updated");
    },
    onError: (error) => {
      toast.error("Failed to update item", { description: error.message });
    },
  });
}

export function useDeleteManagedGoal() {
  const queryClient = useQueryClient();
  const { queryKey } = useManagedGoalQueryKey();
  return useMutation<void, Error, string, ManagedGoalDeleteMutationContext>({
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<ManagedGoalRecord[]>(queryKey) ?? [];
      queryClient.setQueryData<ManagedGoalRecord[]>(
        queryKey,
        (prev) => prev?.filter((goal) => !managedGoalMatchesId(goal, id)) ?? [],
      );
      return { previous };
    },
    mutationFn: (id) => kodyApi.goals.removeManaged(id),
    onSuccess: (_unused, id) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(
        queryKey,
        (prev) => prev?.filter((goal) => !managedGoalMatchesId(goal, id)) ?? [],
      );
      toast.success("Deleted");
    },
    onError: (error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData<ManagedGoalRecord[]>(
          queryKey,
          context.previous,
        );
      }
      toast.error("Failed to delete item", { description: error.message });
    },
  });
}

export function useRunManagedGoal() {
  const queryClient = useQueryClient();
  const { queryKey } = useManagedGoalQueryKey();
  return useMutation<
    { ok: true; workflowId: string; ref: string; goal: ManagedGoalRecord },
    Error,
    string
  >({
    mutationFn: (id) => kodyApi.goals.runManaged(id),
    onSuccess: (result) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(queryKey, (prev) =>
        mergeManagedGoalRecord(prev, result.goal),
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
  const { queryKey } = useManagedGoalQueryKey();
  return useMutation<
    ManagedGoalRecord,
    Error,
    ManagedGoalStateMutationInput,
    ManagedGoalStateMutationContext
  >({
    onMutate: async ({ id, state, pausedReason }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<ManagedGoalRecord[]>(queryKey) ?? [];
      queryClient.setQueryData<ManagedGoalRecord[]>(queryKey, (prev) =>
        patchManagedGoalState(prev, id, state, pausedReason),
      );
      return { previous };
    },
    mutationFn: ({ id, state, pausedReason }) =>
      kodyApi.goals.updateManaged(id, {
        state,
        ...(pausedReason ? { pausedReason } : {}),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ManagedGoalRecord[]>(queryKey, (prev) =>
        mergeManagedGoalRecord(prev, updated),
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
          queryKey,
          context.previous,
        );
      }
      toast.error("Failed to update item", { description: error.message });
    },
  });
}
