/**
 * @fileType hook
 * @domain kody
 * @pattern changelog-hook
 * @ai-summary React Query hook for CHANGELOG.md from the connected repo.
 *   Read-only — file is maintained by webhook handlers on merge/release.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  kodyApi,
  type ChangelogPayload,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";
import { useAuth } from "../auth-context";

export interface ChangelogQueryScope {
  owner?: string | null;
  repo?: string | null;
}

export function changelogQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): ChangelogQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const changelogQueryKeys = {
  all: ["kody-changelog"] as const,
  file: (scope: ChangelogQueryScope = {}) =>
    ["kody-changelog", scope.owner ?? null, scope.repo ?? null] as const,
};

function useChangelogQueryScope() {
  const { auth } = useAuth();
  const currentAuth = auth ?? getStoredAuth();
  return {
    currentAuth,
    scope: changelogQueryScopeFromAuth(currentAuth),
  };
}

export function useChangelog() {
  const { currentAuth, scope } = useChangelogQueryScope();
  return useQuery<ChangelogPayload>({
    queryKey: changelogQueryKeys.file(scope),
    queryFn: () => kodyApi.changelog.get(currentAuth),
    enabled: !!currentAuth,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}
