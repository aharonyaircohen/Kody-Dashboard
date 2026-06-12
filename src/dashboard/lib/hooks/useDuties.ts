/**
 * @fileType hook
 * @domain kody
 * @pattern duty-control-hooks
 * @ai-summary React Query hooks for the Duty Control page.
 *   Backed by `.kody/duties/<slug>/` folders in the connected repo via the
 *   contents API; duties are no longer GitHub issues.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  kodyApi,
  type Duty,
  type DutySchedule,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import { useAuth } from "../auth-context";
import type { DutyStageTemplateSlug } from "../duties/stage-templates";

export interface DutyQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function dutyQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): DutyQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const dutyQueryKeys = {
  all: ["kody-duties"] as const,
  list: (scope: DutyQueryScope = {}) =>
    ["kody-duties", scope.owner ?? null, scope.repo ?? null] as const,
  detail: (slug: string, scope: DutyQueryScope = {}) =>
    ["kody-duty", scope.owner ?? null, scope.repo ?? null, slug] as const,
};

function useDutyQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: dutyQueryScopeFromAuth(currentAuth),
  };
}

export function useDuties() {
  const { currentAuth, scope } = useDutyQueryScope();
  return useQuery({
    queryKey: dutyQueryKeys.list(scope),
    queryFn: () => kodyApi.duties.list(),
    enabled: !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useDuty(slug: string | null) {
  const { currentAuth, scope } = useDutyQueryScope();
  return useQuery({
    queryKey: dutyQueryKeys.detail(slug ?? "", scope),
    queryFn: () => kodyApi.duties.get(slug!),
    enabled: !!currentAuth && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateDuty(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useDutyQueryScope();

  return useMutation<
    Duty,
    Error,
    {
      slug?: string;
      title: string;
      body: string;
      schedule?: DutySchedule | null;
      disabled?: boolean;
      staff?: string | null;
      stage?: DutyStageTemplateSlug | null;
      action?: string | null;
      mentions?: string[];
      executable?: string | null;
      executables?: string[];
      dutyTools?: string[];
      tickScript?: string | null;
    }
  >({
    mutationFn: (data) =>
      kodyApi.duties.create({
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.list(scope) });
      toast.success("Duty created");
    },
    onError: (error) => {
      toast.error("Failed to create duty", { description: error.message });
    },
  });
}

export function useUpdateDuty(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useDutyQueryScope();

  return useMutation<
    Duty,
    Error,
    {
      title?: string;
      body?: string;
      schedule?: DutySchedule | null;
      disabled?: boolean;
      staff?: string | null;
      stage?: DutyStageTemplateSlug | null;
      action?: string | null;
      mentions?: string[];
      executable?: string | null;
      executables?: string[];
      dutyTools?: string[];
      tickScript?: string | null;
    }
  >({
    mutationFn: (data) =>
      kodyApi.duties.update(slug, {
        ...data,
        ...(actorLogin && { actorLogin }),
      }),
    onSuccess: (duty) => {
      queryClient.setQueryData<Duty[]>(dutyQueryKeys.list(scope), (current) =>
        current?.map((item) => (item.slug === duty.slug ? duty : item)),
      );
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.list(scope) });
      queryClient.setQueryData(dutyQueryKeys.detail(slug, scope), duty);
      toast.success("Duty updated");
    },
    onError: (error) => {
      toast.error("Failed to update duty", { description: error.message });
    },
  });
}

export function useRunDuty() {
  return useMutation<
    {
      workflowId: string;
      ref: string;
      action: string;
      duty: string;
      force: boolean;
    },
    Error,
    { slug: string; force?: boolean }
  >({
    mutationFn: ({ slug, force }) => kodyApi.duties.run({ slug }, { force }),
    onSuccess: (data) => {
      toast.success(data.force ? "Duty triggered (force)" : "Duty triggered", {
        description: `Workflow dispatched for @kody ${data.action}.`,
      });
    },
    onError: (error) => {
      toast.error("Failed to dispatch duty", { description: error.message });
    },
  });
}

export function useDeleteDuty(actorLogin?: string) {
  const queryClient = useQueryClient();
  const { scope } = useDutyQueryScope();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.duties.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.list(scope) });
      queryClient.removeQueries({ queryKey: dutyQueryKeys.detail(slug, scope) });
      toast.success("Duty deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete duty", { description: error.message });
    },
  });
}
