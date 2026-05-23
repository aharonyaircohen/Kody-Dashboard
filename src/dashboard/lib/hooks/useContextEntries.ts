/**
 * @fileType hook
 * @domain kody
 * @pattern context-control-hooks
 * @ai-summary React Query hooks for the Context page.
 *   Backed by `.kody/context/<slug>.md` files in the connected repo via
 *   the contents API. Each entry carries a `staff:` list of staff-member
 *   slugs that own it, deciding which consumers load it. Mirrors useStaff.ts.
 *   (Named `useContextEntries`, not `useContext`, to avoid colliding with
 *   React's `useContext`.)
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type ContextEntry,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const contextQueryKeys = {
  list: ["kody-context"] as const,
  detail: (slug: string) => ["kody-context-entry", slug] as const,
};

export function useContextEntries() {
  return useQuery({
    queryKey: contextQueryKeys.list,
    queryFn: () => kodyApi.context.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useContextEntry(slug: string | null) {
  return useQuery({
    queryKey: contextQueryKeys.detail(slug ?? ""),
    queryFn: () => kodyApi.context.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateContextEntry(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    ContextEntry,
    Error,
    {
      slug: string;
      body: string;
      staff: string[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.context.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.list });
      toast.success("Context entry created");
    },
    onError: (error) => {
      toast.error("Failed to create context entry", {
        description: error.message,
      });
    },
  });
}

export function useUpdateContextEntry(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    ContextEntry,
    Error,
    {
      body?: string;
      staff?: string[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.context.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.list });
      queryClient.setQueryData(contextQueryKeys.detail(slug), entry);
      toast.success("Context entry updated");
    },
    onError: (error) => {
      toast.error("Failed to update context entry", {
        description: error.message,
      });
    },
  });
}

export function useDeleteContextEntry(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.context.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.list });
      queryClient.removeQueries({ queryKey: contextQueryKeys.detail(slug) });
      toast.success("Context entry deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete context entry", {
        description: error.message,
      });
    },
  });
}
