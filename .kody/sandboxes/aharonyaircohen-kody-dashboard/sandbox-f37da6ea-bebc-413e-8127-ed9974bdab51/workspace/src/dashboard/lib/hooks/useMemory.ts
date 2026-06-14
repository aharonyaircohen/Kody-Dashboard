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
import { useAuth } from "../auth-context";

export interface MemoryQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function memoryQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): MemoryQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const memoryQueryKeys = {
  all: ["kody-memory"] as const,
  list: (scope: MemoryQueryScope = {}) =>
    ["kody-memory", scope.owner ?? null, scope.repo ?? null] as const,
  detail: (id: string, scope: MemoryQueryScope = {}) =>
    ["kody-memory-entry", scope.owner ?? null, scope.repo ?? null, id] as const,
};

function useMemoryQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: memoryQueryScopeFromAuth(currentAuth),
  };
}

export function useMemories() {
  const { currentAuth, scope } = useMemoryQueryScope();
  return useQuery({
    queryKey: memoryQueryKeys.list(scope),
    queryFn: () => kodyApi.memory.list(),
    enabled: !!currentAuth,
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
  const { scope } = useMemoryQueryScope();

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
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.list(scope) });
      toast.success("Memory saved");
    },
    onError: (error) => {
      toast.error("Failed to save memory", { description: error.message });
    },
  });
}

export function useUpdateMemory(id: string, actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useMemoryQueryScope();

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
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.list(scope) });
      queryClient.setQueryData(memoryQueryKeys.detail(id, scope), memory);
      toast.success("Memory updated");
    },
    onError: (error) => {
      toast.error("Failed to update memory", { description: error.message });
    },
  });
}

export function useDeleteMemory(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useMemoryQueryScope();

  return useMutation<void, Error, string>({
    mutationFn: (id) => kodyApi.memory.remove(id, actorLogin),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: memoryQueryKeys.list(scope) });
      queryClient.removeQueries({
        queryKey: memoryQueryKeys.detail(id, scope),
      });
      toast.success("Memory deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete memory", { description: error.message });
    },
  });
}
