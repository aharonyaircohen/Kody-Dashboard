/**
 * @fileType hook
 * @domain kody
 * @pattern duty-control-hooks
 * @ai-summary React Query hooks for the Duty Control page.
 *   Backed by `.kody/duties/<slug>.md` files in the connected repo via the
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

export const dutyQueryKeys = {
  list: ["kody-duties"] as const,
  detail: (slug: string) => ["kody-duty", slug] as const,
};

export function useDuties() {
  return useQuery({
    queryKey: dutyQueryKeys.list,
    queryFn: () => kodyApi.duties.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useDuty(slug: string | null) {
  return useQuery({
    queryKey: dutyQueryKeys.detail(slug ?? ""),
    queryFn: () => kodyApi.duties.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  });
}

export function useCreateDuty(actorLogin?: string) {
  const queryClient = useQueryClient();

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
      mentions?: string[];
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
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.list });
      toast.success("Duty created");
    },
    onError: (error) => {
      toast.error("Failed to create duty", { description: error.message });
    },
  });
}

export function useUpdateDuty(slug: string, actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Duty,
    Error,
    {
      title?: string;
      body?: string;
      schedule?: DutySchedule | null;
      disabled?: boolean;
      staff?: string | null;
      mentions?: string[];
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
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.list });
      queryClient.setQueryData(dutyQueryKeys.detail(slug), duty);
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
      issueNumber: number;
      commentId: number;
      commentUrl: string;
      force: boolean;
    },
    Error,
    { slug: string; force?: boolean }
  >({
    mutationFn: ({ slug, force }) => kodyApi.duties.run({ slug }, { force }),
    onSuccess: (data) => {
      toast.success(data.force ? "Duty triggered (force)" : "Duty triggered", {
        description:
          "Dispatch comment posted — the engine starts a run now (not on the cron tick).",
      });
    },
    onError: (error) => {
      toast.error("Failed to dispatch duty", { description: error.message });
    },
  });
}

export function useDeleteDuty(actorLogin?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (slug) => kodyApi.duties.remove(slug, actorLogin),
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: dutyQueryKeys.list });
      queryClient.removeQueries({ queryKey: dutyQueryKeys.detail(slug) });
      toast.success("Duty deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete duty", { description: error.message });
    },
  });
}
