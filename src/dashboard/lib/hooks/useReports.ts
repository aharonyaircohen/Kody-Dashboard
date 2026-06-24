/**
 * @fileType hook
 * @domain kody
 * @pattern reports-hooks
 * @ai-summary React Query hooks for system reports. Backed by
 *   `reports/<slug>.md` files in the configured Kody state repo via
 *   the GitHub contents API. Read-only — reports are produced by Kody agentResponsibilities.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  kodyApi,
  type Report,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import { useAuth } from "../auth-context";

export interface ReportQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function reportQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): ReportQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const reportQueryKeys = {
  all: ["kody-reports"] as const,
  list: (scope: ReportQueryScope = {}) =>
    ["kody-reports", scope.owner ?? null, scope.repo ?? null] as const,
  detail: (slug: string, scope: ReportQueryScope = {}) =>
    ["kody-report", scope.owner ?? null, scope.repo ?? null, slug] as const,
};

function useReportQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: reportQueryScopeFromAuth(currentAuth),
  };
}

export interface UseReportsOptions {
  enabled?: boolean;
}

export function useReports(options: UseReportsOptions = {}) {
  const { currentAuth, scope } = useReportQueryScope();
  return useQuery<Report[]>({
    queryKey: reportQueryKeys.list(scope),
    queryFn: () => kodyApi.reports.list(),
    enabled: (options.enabled ?? true) && !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useReport(slug: string | null) {
  const { currentAuth, scope } = useReportQueryScope();
  return useQuery<Report>({
    queryKey: reportQueryKeys.detail(slug ?? "", scope),
    queryFn: () => kodyApi.reports.get(slug!),
    enabled: !!currentAuth && !!slug,
    staleTime: 30_000,
  });
}
