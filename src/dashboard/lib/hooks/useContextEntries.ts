/**
 * @fileType hook
 * @domain kody
 * @pattern context-control-hooks
 * @ai-summary React Query hooks for the Context page.
 *   Backed by `.kody/context/<slug>.md` files in the connected repo via
 *   the contents API. Each entry carries a `agent:` list of agent-member
 *   slugs that own it, deciding which consumers load it. Mirrors useAgents.ts.
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
import { useAuth } from "../auth-context";

export interface ContextQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function contextQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): ContextQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const contextQueryKeys = {
  all: ["kody-context"] as const,
  list: (scope: ContextQueryScope = {}) =>
    ["kody-context", scope.owner ?? null, scope.repo ?? null] as const,
  detail: (slug: string, scope: ContextQueryScope = {}) =>
    [
      "kody-context-entry",
      scope.owner ?? null,
      scope.repo ?? null,
      slug,
    ] as const,
};

function useContextQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: contextQueryScopeFromAuth(currentAuth),
  };
}

export function useContextEntries() {
  const { currentAuth, scope } = useContextQueryScope();
  return useQuery({
    queryKey: contextQueryKeys.list(scope),
    queryFn: () => kodyApi.context.list(),
    enabled: !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useContextEntry(slug: string | null) {
  const { currentAuth, scope } = useContextQueryScope();
  return useQuery({
    queryKey: contextQueryKeys.detail(slug ?? "", scope),
    queryFn: () => kodyApi.context.get(slug!),
    enabled: !!currentAuth && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateContextEntry(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useContextQueryScope();

  return useMutation<
    ContextEntry,
    Error,
    {
      slug: string;
      body: string;
      agent: string[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.context.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.list(scope) });
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
  const { scope } = useContextQueryScope();

  return useMutation<
    ContextEntry,
    Error,
    {
      body?: string;
      agent?: string[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.context.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.list(scope) });
      queryClient.setQueryData(contextQueryKeys.detail(slug, scope), entry);
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
  const { scope } = useContextQueryScope();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.context.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: contextQueryKeys.list(scope) });
      queryClient.removeQueries({
        queryKey: contextQueryKeys.detail(slug, scope),
      });
      toast.success("Context entry deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete context entry", {
        description: error.message,
      });
    },
  });
}
