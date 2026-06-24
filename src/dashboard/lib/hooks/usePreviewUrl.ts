/**
 * @fileType hook
 * @domain kody
 * @pattern usePreviewUrl
 * @ai-summary Resolves a PR's preview URL on demand (Fly-first, Vercel
 * fallback), then explicitly wakes Fly previews when a pane opens.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { prsApi, getStoredAuth } from "../api";

const BUILDING_POLL_MS = 15_000;

function isFlyPreviewUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith(".fly.dev");
  } catch {
    return false;
  }
}

export function usePreviewUrl(
  sha: string | undefined,
  pr?: number,
  initialUrl?: string | null,
) {
  const query = useQuery({
    queryKey: ["preview-url", sha, pr],
    queryFn: () => prsApi.preview(sha!, pr),
    enabled: !!getStoredAuth() && !!sha,
    // Show the link the tasks list already knew about while we confirm it.
    placeholderData: initialUrl ?? undefined,
    // Once we have a URL it will not change for this commit. While it is null
    // (still building), keep checking so it appears on its own.
    refetchInterval: (q) => (q.state.data ? false : BUILDING_POLL_MS),
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });

  const url = query.data ?? initialUrl ?? null;
  const inFlightWakeKeyRef = useRef<string | null>(null);
  const createAttemptKeyRef = useRef<string | null>(null);
  const wakePreview = useCallback(async (): Promise<void> => {
    if (!pr || !isFlyPreviewUrl(url)) return;

    const wakeKey = `${pr}:${url}`;
    if (inFlightWakeKeyRef.current === wakeKey) return;

    inFlightWakeKeyRef.current = wakeKey;
    try {
      await prsApi.wakePreview(pr);
    } finally {
      if (inFlightWakeKeyRef.current === wakeKey) {
        inFlightWakeKeyRef.current = null;
      }
    }
  }, [pr, url]);

  useEffect(() => {
    if (!pr || !sha || url || query.data !== null) return;
    if (query.isPending || query.isFetching) return;

    const createKey = `${pr}:${sha}`;
    if (createAttemptKeyRef.current === createKey) return;

    createAttemptKeyRef.current = createKey;
    void prsApi
      .createPreview(pr, sha)
      .then(() => {
        void query.refetch();
      })
      .catch(() => {
        // No Fly token or build spawn failure: keep the normal polling/empty
        // preview state instead of breaking the task page.
      });
  }, [pr, query, sha, url]);

  // "Loading" means we are looking up the URL and do not have one yet.
  const isResolving = !!sha && !url && (query.isFetching || query.isPending);

  return { url, isResolving, wakePreview };
}
