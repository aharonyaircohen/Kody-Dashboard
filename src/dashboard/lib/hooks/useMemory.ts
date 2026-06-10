/**
 * @fileType hook
 * @domain kody
 * @pattern memory-hooks
 * @ai-summary React Query hooks for Kody memory management.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getStoredAuth,
  kodyApi,
  NoTokenError,
  SessionExpiredError,
  type MemoryFile,
  type MemoryType,
} from "../api";

export const memoryQueryKeys = {
  list: ["kody-memory"] as const,
  detail: (id: string) => ["kody-memory-entry", id] as const,
};

export function useMemories() {
  return useQuery({
    queryKey: memoryQueryKeys.list,
    queryFn: () => kodyApi.memory.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useCreateMemory(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    MemoryFile,
    Error,
    {
      id: string;
      name: string;
      description: string;
      type: MemoryType;
      body: string;
    }
  >({
    mutationFn: (data) =>
      kodyApi.memory.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.list });
      toast.success("Memory saved");
    },
    onError: (error) => {
      toast.error("Failed to save memory", { description: error.message });
    },
  });
}

export function useUpdateMemory(id: string, actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    MemoryFile,
    Error,
    {
      name?: string;
      description?: string;
      type?: MemoryType;
      body?: string;
    }
  >({
    mutationFn: (data) =>
      kodyApi.memory.update(id, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (memory) => {
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.list });
      queryClient.setQueryData(memoryQueryKeys.detail(id), memory);
      toast.success("Memory updated");
    },
    onError: (error) => {
      toast.error("Failed to update memory", { description: error.message });
    },
  });
}

export function useDeleteMemory(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (id) => kodyApi.memory.remove(id, actorLogin),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.list });
      queryClient.removeQueries({ queryKey: memoryQueryKeys.detail(id) });
      toast.success("Memory deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete memory", { description: error.message });
    },
  });
}
