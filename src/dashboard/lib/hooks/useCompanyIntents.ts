/**
 * @fileType hook
 * @domain kody
 * @pattern company-intents
 * @ai-summary React Query hooks for CTO agency-architect intents.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  getStoredAuth,
  kodyApi,
  NoTokenError,
  SessionExpiredError,
} from "../api";
import type {
  CompanyIntentInput,
  CompanyIntentRecord,
  CompanyIntentStatus,
} from "../company-intents";

export const companyIntentQueryKeys = {
  list: ["kody-company-intents"] as const,
};

function mergeIntentRecord(
  records: CompanyIntentRecord[] | undefined,
  next: CompanyIntentRecord,
): CompanyIntentRecord[] {
  if (!records) return [next];
  const found = records.some((record) => record.id === next.id);
  const merged = found
    ? records.map((record) => (record.id === next.id ? next : record))
    : [...records, next];
  return merged.sort(
    (a, b) => a.intent.priority - b.intent.priority || a.id.localeCompare(b.id),
  );
}

export function useCompanyIntents() {
  return useQuery({
    queryKey: companyIntentQueryKeys.list,
    queryFn: () => kodyApi.companyIntents.list(),
    enabled: Boolean(getStoredAuth()),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (
        error instanceof NoTokenError ||
        error instanceof SessionExpiredError
      ) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

export function useCreateCompanyIntent() {
  const queryClient = useQueryClient();
  return useMutation<CompanyIntentRecord, Error, CompanyIntentInput>({
    mutationFn: (data) => kodyApi.companyIntents.create(data),
    onSuccess: (created) => {
      queryClient.setQueryData<CompanyIntentRecord[]>(
        companyIntentQueryKeys.list,
        (prev) => mergeIntentRecord(prev, created),
      );
      queryClient.invalidateQueries({ queryKey: companyIntentQueryKeys.list });
      toast.success("Intent created");
    },
    onError: (error) => {
      toast.error("Failed to create intent", { description: error.message });
    },
  });
}

export function useUpdateCompanyIntent() {
  const queryClient = useQueryClient();
  return useMutation<
    CompanyIntentRecord,
    Error,
    {
      id: string;
      data: Partial<CompanyIntentInput> & { status?: CompanyIntentStatus };
    }
  >({
    mutationFn: ({ id, data }) => kodyApi.companyIntents.update(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData<CompanyIntentRecord[]>(
        companyIntentQueryKeys.list,
        (prev) => mergeIntentRecord(prev, updated),
      );
      queryClient.invalidateQueries({ queryKey: companyIntentQueryKeys.list });
      toast.success("Intent updated");
    },
    onError: (error) => {
      toast.error("Failed to update intent", { description: error.message });
    },
  });
}

export function useRunCompanyIntent() {
  const queryClient = useQueryClient();
  return useMutation<
    {
      ok: true;
      workflowId: string;
      ref: string;
      action: string;
      intentId: string;
    },
    Error,
    string
  >({
    mutationFn: (id) => kodyApi.companyIntents.run(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companyIntentQueryKeys.list });
      toast.success("CTO review started");
    },
    onError: (error) => {
      toast.error("Failed to start CTO review", { description: error.message });
    },
  });
}
