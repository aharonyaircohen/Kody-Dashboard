/**
 * @fileType hook
 * @domain kody
 * @pattern goals-hooks
 * @ai-summary React Query hooks for the Goals feature. Mirrors useDuties:
 *   list query + create/update/delete mutations.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type Goal,
  type GoalDiscussionComment,
  type GoalDiscussionPayload,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const goalQueryKeys = {
  list: ["kody-goals"] as const,
  capabilities: ["kody-goals", "capabilities"] as const,
  discussion: (id: string) => ["kody-goals", "discussion", id] as const,
};

export function useGoals() {
  return useQuery({
    queryKey: goalQueryKeys.list,
    queryFn: () => kodyApi.goals.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    // Poll every 30s so goals created externally (kody engine creating
    // qa-engineer goals from a developer machine, manifest edits via the
    // GitHub UI, etc.) become visible without a hard refresh. We can't
    // rely on refetchOnWindowFocus — it's globally disabled in
    // KodyProviders to avoid refresh loops on session expiry — and
    // staleTime alone never triggers a refetch on its own.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

/**
 * Fetches the goals list along with capability flags (e.g. discussionsEnabled).
 * Separate query key so the simple `useGoals()` consumers don't see the
 * extra payload, and so the cap query can have a longer stale time.
 */
export function useGoalsCapabilities() {
  return useQuery({
    queryKey: goalQueryKeys.capabilities,
    queryFn: () => kodyApi.goals.listWithCapabilities(),
    enabled: !!getStoredAuth(),
    staleTime: 5 * 60_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

/**
 * Discussion thread for a single goal. Lazy-creates the backing GitHub
 * Discussion on first read if the repo supports it. Returns `enabled: false`
 * with a reason when the thread can't be provisioned.
 */
export function useGoalDiscussion(goalId: string | null) {
  return useQuery<GoalDiscussionPayload>({
    queryKey: goalId
      ? goalQueryKeys.discussion(goalId)
      : ["kody-goals", "discussion", "__none__"],
    queryFn: () => kodyApi.goals.fetchDiscussion(goalId!),
    enabled: !!goalId && !!getStoredAuth(),
    // Comments cache 60s on the server too — match here so stale UI doesn't
    // pile on extra GraphQL hits.
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function usePostGoalDiscussionComment(
  goalId: string,
  actorLogin?: string,
) {
  const queryClient = useQueryClient();
  return useMutation<GoalDiscussionComment, Error, string>({
    mutationFn: (body) =>
      kodyApi.goals.postDiscussionComment(goalId, body, actorLogin),
    onSuccess: (created) => {
      queryClient.setQueryData<GoalDiscussionPayload>(
        goalQueryKeys.discussion(goalId),
        (prev) => {
          if (!prev) return prev;
          if (!prev.enabled) return prev;
          if (prev.comments.some((c) => c.id === created.id)) return prev;
          return { ...prev, comments: [...prev.comments, created] };
        },
      );
      queryClient.invalidateQueries({
        queryKey: goalQueryKeys.discussion(goalId),
      });
    },
    onError: (error) => {
      toast.error("Failed to post comment", { description: error.message });
    },
  });
}

export function useCreateGoal(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Goal,
    Error,
    { name: string; description?: string; dueDate?: string; assignee?: string }
  >({
    mutationFn: (data) =>
      kodyApi.goals.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (created) => {
      // Insert the new goal directly so it appears instantly, regardless of
      // GitHub eventual consistency or any downstream cache. The invalidation
      // below schedules a background refetch to reconcile.
      queryClient.setQueryData<Goal[]>(goalQueryKeys.list, (prev) => {
        if (!prev) return [created];
        if (prev.some((g) => g.id === created.id)) return prev;
        return [...prev, created];
      });
      queryClient.invalidateQueries({ queryKey: goalQueryKeys.list });
      toast.success("Goal created");
    },
    onError: (error) => {
      toast.error("Failed to create goal", { description: error.message });
    },
  });
}

export function useUpdateGoal(id: string, actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Goal,
    Error,
    {
      name?: string;
      description?: string | null;
      dueDate?: string | null;
      assignee?: string | null;
    }
  >({
    mutationFn: (data) =>
      kodyApi.goals.update(id, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Goal[]>(goalQueryKeys.list, (prev) =>
        prev ? prev.map((g) => (g.id === updated.id ? updated : g)) : prev,
      );
      queryClient.invalidateQueries({ queryKey: goalQueryKeys.list });
      toast.success("Goal updated");
    },
    onError: (error) => {
      toast.error("Failed to update goal", { description: error.message });
    },
  });
}

export function useReorderGoals(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<Goal[], Error, string[], { previous: Goal[] | undefined }>(
    {
      mutationFn: (orderedIds) => kodyApi.goals.reorder(orderedIds, actorLogin),
      onMutate: async (orderedIds) => {
        await queryClient.cancelQueries({ queryKey: goalQueryKeys.list });
        const previous = queryClient.getQueryData<Goal[]>(goalQueryKeys.list);
        if (previous) {
          const byId = new Map(previous.map((g) => [g.id, g]));
          const next: Goal[] = [];
          const seen = new Set<string>();
          for (const id of orderedIds) {
            const g = byId.get(id);
            if (g && !seen.has(id)) {
              next.push(g);
              seen.add(id);
            }
          }
          for (const g of previous) {
            if (!seen.has(g.id)) next.push(g);
          }
          queryClient.setQueryData<Goal[]>(goalQueryKeys.list, next);
        }
        return { previous };
      },
      onError: (error, _ids, context) => {
        if (context?.previous) {
          queryClient.setQueryData(goalQueryKeys.list, context.previous);
        }
        toast.error("Failed to reorder goals", { description: error.message });
      },
      onSuccess: (goals) => {
        queryClient.setQueryData<Goal[]>(goalQueryKeys.list, goals);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: goalQueryKeys.list });
      },
    },
  );
}

export function useDeleteGoal(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (id) => kodyApi.goals.remove(id, actorLogin),
    onSuccess: (_, removedId) => {
      queryClient.setQueryData<Goal[]>(goalQueryKeys.list, (prev) =>
        prev ? prev.filter((g) => g.id !== removedId) : prev,
      );
      queryClient.invalidateQueries({ queryKey: goalQueryKeys.list });
      toast.success("Goal removed");
    },
    onError: (error) => {
      toast.error("Failed to remove goal", { description: error.message });
    },
  });
}
