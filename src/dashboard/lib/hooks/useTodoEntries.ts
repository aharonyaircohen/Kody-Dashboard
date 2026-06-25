/**
 * @fileType hook
 * @domain todos
 * @pattern todo-control-hooks
 * @ai-summary React Query hooks for the Kody worklist page. Backed by
 * `todos/<slug>.md` files in the state repo via the API.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type TodoEntry,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import { useAuth } from "../auth-context";

export interface TodoQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function todoQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): TodoQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const todoQueryKeys = {
  all: ["kody-todos"] as const,
  list: (scope: TodoQueryScope = {}) =>
    ["kody-todos", scope.owner ?? null, scope.repo ?? null] as const,
  detail: (slug: string, scope: TodoQueryScope = {}) =>
    ["kody-todo", scope.owner ?? null, scope.repo ?? null, slug] as const,
};

function useTodoQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return { currentAuth, scope: todoQueryScopeFromAuth(currentAuth) };
}

export function useTodoEntries() {
  const { currentAuth, scope } = useTodoQueryScope();
  return useQuery({
    queryKey: todoQueryKeys.list(scope),
    queryFn: () => kodyApi.todos.list(),
    enabled: !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useTodoEntry(slug: string | null) {
  const { currentAuth, scope } = useTodoQueryScope();
  return useQuery({
    queryKey: todoQueryKeys.detail(slug ?? "", scope),
    queryFn: () => kodyApi.todos.get(slug!),
    enabled: !!currentAuth && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateTodo(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useTodoQueryScope();
  return useMutation<
    TodoEntry,
    Error,
    {
      title: string;
      items?: Array<{
        id?: string;
        title: string;
        body?: string;
        completed?: boolean;
        createdAt?: string;
        completedAt?: string | null;
      }>;
    }
  >({
    mutationFn: (data) =>
      kodyApi.todos.create({ ...data, ...(actorLogin && { actorLogin }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: todoQueryKeys.list(scope) });
      toast.success("Todo created");
    },
    onError: (error) => {
      toast.error("Failed to create todo", {
        description: error.message,
      });
    },
  });
}

export function useUpdateTodo(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useTodoQueryScope();
  return useMutation<
    TodoEntry,
    Error,
    {
      title?: string;
      items?: TodoEntry["items"];
    }
  >({
    mutationFn: (data) =>
      kodyApi.todos.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (todo) => {
      queryClient.invalidateQueries({ queryKey: todoQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: todoQueryKeys.list(scope) });
      queryClient.setQueryData(todoQueryKeys.detail(slug, scope), todo);
      toast.success("Todo updated");
    },
    onError: (error) => {
      toast.error("Failed to update todo", {
        description: error.message,
      });
    },
  });
}

export function useDeleteTodo(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useTodoQueryScope();
  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.todos.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: todoQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: todoQueryKeys.list(scope) });
      queryClient.removeQueries({
        queryKey: todoQueryKeys.detail(slug, scope),
      });
      toast.success("Todo deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete todo", {
        description: error.message,
      });
    },
  });
}
