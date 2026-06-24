/**
 * @fileType hook
 * @domain kody
 * @pattern agentResponsibility-control-hooks
 * @ai-summary React Query hooks for the AgentResponsibility Control page.
 *   Backed by `.kody/agent-responsibilities/<slug>/` folders in the connected repo via the
 *   contents API; agentResponsibilities are no longer GitHub issues.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type AgentResponsibility,
  type AgentResponsibilityCapabilityKind,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import { useAuth } from "../auth-context";

export interface AgentResponsibilityQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function agentResponsibilityQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): AgentResponsibilityQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const agentResponsibilityQueryKeys = {
  all: ["kody-agentResponsibilities"] as const,
  list: (scope: AgentResponsibilityQueryScope = {}) =>
    [
      "kody-agentResponsibilities",
      scope.owner ?? null,
      scope.repo ?? null,
    ] as const,
  detail: (slug: string, scope: AgentResponsibilityQueryScope = {}) =>
    [
      "kody-agentResponsibility",
      scope.owner ?? null,
      scope.repo ?? null,
      slug,
    ] as const,
};

function useAgentResponsibilityQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: agentResponsibilityQueryScopeFromAuth(currentAuth),
  };
}

export function useAgentResponsibilities() {
  const { currentAuth, scope } = useAgentResponsibilityQueryScope();
  return useQuery({
    queryKey: agentResponsibilityQueryKeys.list(scope),
    queryFn: () => kodyApi.agentResponsibilities.list(),
    enabled: !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useAgentResponsibility(slug: string | null) {
  const { currentAuth, scope } = useAgentResponsibilityQueryScope();
  return useQuery({
    queryKey: agentResponsibilityQueryKeys.detail(slug ?? "", scope),
    queryFn: () => kodyApi.agentResponsibilities.get(slug!),
    enabled: !!currentAuth && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateAgentResponsibility(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useAgentResponsibilityQueryScope();

  return useMutation<
    AgentResponsibility,
    Error,
    {
      slug?: string;
      title: string;
      body: string;
      capabilityKind?: AgentResponsibilityCapabilityKind | null;
      disabled?: boolean;
      agent?: string | null;
      reviewer?: string | null;
      action?: string | null;
      mentions?: string[];
      agentAction?: string | null;
      agentActions?: string[];
      agentResponsibilityTools?: string[];
      tickScript?: string | null;
      readsFrom?: string[];
      writesTo?: string[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.agentResponsibilities.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: agentResponsibilityQueryKeys.all,
      });
      queryClient.invalidateQueries({
        queryKey: agentResponsibilityQueryKeys.list(scope),
      });
      toast.success("AgentResponsibility created");
    },
    onError: (error) => {
      toast.error("Failed to create agentResponsibility", {
        description: error.message,
      });
    },
  });
}

export function useUpdateAgentResponsibility(
  slug: string,
  actorLogin?: string,
) {
  const queryClient = useQueryClient();
  const { scope } = useAgentResponsibilityQueryScope();

  return useMutation<
    AgentResponsibility,
    Error,
    {
      title?: string;
      body?: string;
      capabilityKind?: AgentResponsibilityCapabilityKind | null;
      disabled?: boolean;
      agent?: string | null;
      reviewer?: string | null;
      action?: string | null;
      mentions?: string[];
      agentAction?: string | null;
      agentActions?: string[];
      agentResponsibilityTools?: string[];
      tickScript?: string | null;
      readsFrom?: string[];
      writesTo?: string[];
    }
  >({
    mutationFn: (data) =>
      kodyApi.agentResponsibilities.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (agentResponsibility) => {
      queryClient.setQueryData<AgentResponsibility[]>(
        agentResponsibilityQueryKeys.list(scope),
        (current) =>
          current?.map((item) =>
            item.slug === agentResponsibility.slug ? agentResponsibility : item,
          ),
      );
      queryClient.invalidateQueries({
        queryKey: agentResponsibilityQueryKeys.all,
      });
      queryClient.invalidateQueries({
        queryKey: agentResponsibilityQueryKeys.list(scope),
      });
      queryClient.setQueryData(
        agentResponsibilityQueryKeys.detail(slug, scope),
        agentResponsibility,
      );
      toast.success("AgentResponsibility updated");
    },
    onError: (error) => {
      toast.error("Failed to update agentResponsibility", {
        description: error.message,
      });
    },
  });
}

export function useRunAgentResponsibility() {
  return useMutation<
    {
      workflowId: string;
      ref: string;
      action: string;
      agentResponsibility: string;
      force: boolean;
    },
    Error,
    { slug: string; force?: boolean }
  >({
    mutationFn: ({ slug, force }) =>
      kodyApi.agentResponsibilities.run({ slug }, { force }),
    onSuccess: (data) => {
      toast.success(
        data.force
          ? "AgentResponsibility triggered (force)"
          : "AgentResponsibility triggered",
        {
          description: `Workflow dispatched for @kody ${data.action}.`,
        },
      );
    },
    onError: (error) => {
      toast.error("Failed to dispatch agentResponsibility", {
        description: error.message,
      });
    },
  });
}

export function useDeleteAgentResponsibility(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useAgentResponsibilityQueryScope();

  return useMutation<void, Error, string>({
    mutationFn: (slug) =>
      kodyApi.agentResponsibilities.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({
        queryKey: agentResponsibilityQueryKeys.all,
      });
      queryClient.invalidateQueries({
        queryKey: agentResponsibilityQueryKeys.list(scope),
      });
      queryClient.removeQueries({
        queryKey: agentResponsibilityQueryKeys.detail(slug, scope),
      });
      toast.success("AgentResponsibility removed");
    },
    onError: (error) => {
      toast.error("Failed to remove agentResponsibility", {
        description: error.message,
      });
    },
  });
}
