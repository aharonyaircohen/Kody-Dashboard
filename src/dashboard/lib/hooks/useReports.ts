/**
 * @fileType hook
 * @domain kody
 * @pattern reports-hooks
 * @ai-summary React Query hooks for system reports. Backed by
 *   `kody-state:.kody/reports/<slug>.md` files in the connected repo via
 *   the GitHub contents API. Read-only — reports are produced by Kody duties.
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

export const reportQueryKeys = {
  list: ["kody-reports"] as const,
  detail: (slug: string) => ["kody-report", slug] as const,
};

export function useReports() {
  return useQuery<Report[]>({
    queryKey: reportQueryKeys.list,
    queryFn: () => kodyApi.reports.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useReport(slug: string | null) {
  return useQuery<Report>({
    queryKey: reportQueryKeys.detail(slug ?? ""),
    queryFn: () => kodyApi.reports.get(slug!),
    enabled: !!getStoredAuth() && !!slug,
    staleTime: 30_000,
  });
}
