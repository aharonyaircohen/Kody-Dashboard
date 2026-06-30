/**
 * @fileType hook
 * @domain capabilities
 * @pattern capability-hooks
 * @ai-summary React Query hooks for listing and manually running capabilities.
 */
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type CapabilitySummary,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import { useAuth } from "../auth-context";

export interface CapabilityQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function capabilityQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): CapabilityQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const capabilityQueryKeys = {
  all: ["kody-capabilities"] as const,
  list: (scope: CapabilityQueryScope = {}) =>
    ["kody-capabilities", scope.owner ?? null, scope.repo ?? null] as const,
};

function useCapabilityQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: capabilityQueryScopeFromAuth(currentAuth),
  };
}

export function useCapabilities() {
  const { currentAuth, scope } = useCapabilityQueryScope();
  return useQuery({
    queryKey: capabilityQueryKeys.list(scope),
    queryFn: () => kodyApi.capabilities.list(),
    enabled: !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useRunCapability() {
  return useMutation<
    {
      workflowId: string;
      ref: string;
      action: string;
      capability: string;
      force: boolean;
    },
    Error,
    { slug: string; force?: boolean }
  >({
    mutationFn: ({ slug, force }) =>
      kodyApi.capabilities.run({ slug }, { force }),
    onSuccess: (data) => {
      toast.success(
        data.force ? "Capability triggered (force)" : "Capability triggered",
        {
          description: `Workflow dispatched for ${data.action}.`,
        },
      );
    },
    onError: (error) => {
      toast.error("Failed to dispatch capability", {
        description: error.message,
      });
    },
  });
}

export type { CapabilitySummary };
