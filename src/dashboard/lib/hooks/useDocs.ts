/**
 * @fileType hook
 * @domain docs
 * @pattern docs-hook
 * @ai-summary React Query hooks for docs (README.md + docs/*.md) from the
 *   connected repo. Read-only — docs are maintained in PRs.
 */
"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import {
  kodyApi,
  type DocsManifestPayload,
  type DocFilePayload,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const docsManifestQueryKey = ["kody-docs-manifest"] as const;

export function useDocsManifest() {
  return useQuery<DocsManifestPayload>({
    queryKey: docsManifestQueryKey,
    queryFn: () => kodyApi.docs.list(),
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}

export function useDoc(path: string) {
  return useQuery<DocFilePayload>({
    queryKey: ["kody-doc", path] as const,
    queryFn: () => kodyApi.docs.get(path),
    enabled: !!getStoredAuth() && path.length > 0,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof SessionExpiredError) return false;
      if (error instanceof NoTokenError) return false;
      return failureCount < 2;
    },
  });
}
