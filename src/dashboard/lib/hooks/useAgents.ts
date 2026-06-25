/**
 * @fileType hook
 * @domain kody
 * @pattern agent-control-hooks
 * @ai-summary React Query hooks for the Agent Control page.
 *   Backed by `agents/<slug>.md` files in the state repo via the API.
 *   Duplicated from useAgentResponsibilities.ts.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type Agent,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import { useAuth } from "../auth-context";

export interface AgentQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function agentQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): AgentQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const agentQueryKeys = {
  all: ["kody-agent"] as const,
  list: (scope: AgentQueryScope = {}) =>
    ["kody-agent", scope.owner ?? null, scope.repo ?? null] as const,
  detail: (slug: string, scope: AgentQueryScope = {}) =>
    [
      "kody-agent-member",
      scope.owner ?? null,
      scope.repo ?? null,
      slug,
    ] as const,
};

function useAgentsQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: agentQueryScopeFromAuth(currentAuth),
  };
}

export function useAgents() {
  const { currentAuth, scope } = useAgentsQueryScope();
  return useQuery({
    queryKey: agentQueryKeys.list(scope),
    queryFn: () => kodyApi.agent.list(),
    enabled: !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useAgent(slug: string | null) {
  const { currentAuth, scope } = useAgentsQueryScope();
  return useQuery({
    queryKey: agentQueryKeys.detail(slug ?? "", scope),
    queryFn: () => kodyApi.agent.get(slug!),
    enabled: !!currentAuth && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateAgent(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useAgentsQueryScope();

  return useMutation<
    Agent,
    Error,
    {
      slug?: string;
      title: string;
      body: string;
    }
  >({
    mutationFn: (data) =>
      kodyApi.agent.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.list(scope) });
      toast.success("Agent member created");
    },
    onError: (error) => {
      toast.error("Failed to create agent", {
        description: error.message,
      });
    },
  });
}

export function useUpdateAgent(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useAgentsQueryScope();

  return useMutation<
    Agent,
    Error,
    {
      title?: string;
      body?: string;
    }
  >({
    mutationFn: (data) =>
      kodyApi.agent.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (agentMember) => {
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.list(scope) });
      queryClient.setQueryData(agentQueryKeys.detail(slug, scope), agentMember);
      toast.success("Agent member updated");
    },
    onError: (error) => {
      toast.error("Failed to update agent", {
        description: error.message,
      });
    },
  });
}

export function useDeleteAgent(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useAgentsQueryScope();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.agent.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: agentQueryKeys.list(scope) });
      queryClient.removeQueries({
        queryKey: agentQueryKeys.detail(slug, scope),
      });
      toast.success("Agent member removed");
    },
    onError: (error) => {
      toast.error("Failed to remove agent", {
        description: error.message,
      });
    },
  });
}

/**
 * Dispatch an ad-hoc message to an agent — runs the agent one-shot
 * (like a agentResponsibility) and replies on the control issue. When `actorLogin` is set,
 * the reply @-mentions the requester so it lands in their inbox.
 */
export function useDispatchAgent(actorLogin?: string) {
  return useMutation<
    { issueNumber: number; commentId: number; commentUrl: string },
    Error,
    { slug: string; message: string }
  >({
    mutationFn: ({ slug, message }) =>
      kodyApi.agent.dispatch(slug, {
        message,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      toast.success("Task sent", {
        description:
          "The agent is running it now — the reply will appear on the control issue" +
          (actorLogin ? " and in your inbox." : "."),
      });
    },
    onError: (error) => {
      toast.error("Failed to send task", { description: error.message });
    },
  });
}
