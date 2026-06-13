/**
 * @fileType hook
 * @domain docs
 * @pattern docs-hook
 * @ai-summary React Query hooks for docs (README.md + docs/*.md) from the
 *   connected repo.
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  kodyApi,
  type DocsManifestPayload,
  type DocFilePayload,
  NoTokenError,
  SessionExpiredError,
  getStoredAuth,
} from "../api";

export const docsManifestQueryKey = ["kody-docs-manifest"] as const;

export const docQueryKey = (path: string) => ["kody-doc", path] as const;

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
    queryKey: docQueryKey(path),
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

export function useCreateDoc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; content: string }) =>
      kodyApi.docs.create(input),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: docsManifestQueryKey });
      queryClient.setQueryData(docQueryKey(doc.path), doc);
    },
  });
}

export function useUpdateDoc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      path: string;
      content?: string;
      newPath?: string;
    }) => {
      const { path, ...payload } = input;
      return kodyApi.docs.update(path, payload);
    },
    onSuccess: (doc, input) => {
      queryClient.invalidateQueries({ queryKey: docsManifestQueryKey });
      queryClient.invalidateQueries({ queryKey: docQueryKey(input.path) });
      queryClient.setQueryData(docQueryKey(doc.path), doc);
    },
  });
}

export function useDeleteDoc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => kodyApi.docs.remove(path),
    onSuccess: (_result, path) => {
      queryClient.invalidateQueries({ queryKey: docsManifestQueryKey });
      queryClient.removeQueries({ queryKey: docQueryKey(path) });
    },
  });
}
