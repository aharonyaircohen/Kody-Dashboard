/**
 * @fileType hook
 * @domain kody
 * @pattern docs-control-hooks
 * @ai-summary React Query hooks for the Documentation page.
 *   Backed by `.kody/docs/<slug>.md` files in the connected repo via
 *   the contents API. Each doc carries a `staff:` list of staff-member
 *   slugs that own it, deciding which consumers load it. Mirrors useStaff.ts.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type Doc,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const docsQueryKeys = {
  list: ["kody-docs"] as const,
  detail: (slug: string) => ["kody-doc", slug] as const,
};

export function useDocs() {
  return useQuery({
    queryKey: docsQueryKeys.list,
    queryFn: () => kodyApi.docs.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useDoc(slug: string | null) {
  return useQuery({
    queryKey: docsQueryKeys.detail(slug ?? ""),
    queryFn: () => kodyApi.docs.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateDoc(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Doc,
    Error,
    {
      slug: string;
      body: string;
      staff: string[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.docs.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: docsQueryKeys.list });
      toast.success("Doc created");
    },
    onError: (error) => {
      toast.error("Failed to create doc", {
        description: error.message,
      });
    },
  });
}

export function useUpdateDoc(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Doc,
    Error,
    {
      body?: string;
      staff?: string[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.docs.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: docsQueryKeys.list });
      queryClient.setQueryData(docsQueryKeys.detail(slug), doc);
      toast.success("Doc updated");
    },
    onError: (error) => {
      toast.error("Failed to update doc", {
        description: error.message,
      });
    },
  });
}

export function useDeleteDoc(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.docs.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: docsQueryKeys.list });
      queryClient.removeQueries({ queryKey: docsQueryKeys.detail(slug) });
      toast.success("Doc deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete doc", {
        description: error.message,
      });
    },
  });
}
