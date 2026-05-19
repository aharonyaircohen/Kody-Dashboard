/**
 * @fileType hook
 * @domain kody
 * @pattern worker-control-hooks
 * @ai-summary React Query hooks for the Worker Control page.
 *   Backed by `.kody/workers/<slug>.md` files in the connected repo via
 *   the contents API. Duplicated from useJobs.ts.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type Worker,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const workerQueryKeys = {
  list: ["kody-workers"] as const,
  detail: (slug: string) => ["kody-worker", slug] as const,
};

export function useWorkers() {
  return useQuery({
    queryKey: workerQueryKeys.list,
    queryFn: () => kodyApi.workers.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useWorker(slug: string | null) {
  return useQuery({
    queryKey: workerQueryKeys.detail(slug ?? ""),
    queryFn: () => kodyApi.workers.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateWorker(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Worker,
    Error,
    {
      slug?: string;
      title: string;
      body: string;
    }
  >({
    mutationFn: (data) =>
      kodyApi.workers.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workerQueryKeys.list });
      toast.success("Worker created");
    },
    onError: (error) => {
      toast.error("Failed to create worker", { description: error.message });
    },
  });
}

export function useUpdateWorker(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Worker,
    Error,
    {
      title?: string;
      body?: string;
    }
  >({
    mutationFn: (data) =>
      kodyApi.workers.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (worker) => {
      queryClient.invalidateQueries({ queryKey: workerQueryKeys.list });
      queryClient.setQueryData(workerQueryKeys.detail(slug), worker);
      toast.success("Worker updated");
    },
    onError: (error) => {
      toast.error("Failed to update worker", { description: error.message });
    },
  });
}

export function useDeleteWorker(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.workers.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: workerQueryKeys.list });
      queryClient.removeQueries({ queryKey: workerQueryKeys.detail(slug) });
      toast.success("Worker deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete worker", { description: error.message });
    },
  });
}
