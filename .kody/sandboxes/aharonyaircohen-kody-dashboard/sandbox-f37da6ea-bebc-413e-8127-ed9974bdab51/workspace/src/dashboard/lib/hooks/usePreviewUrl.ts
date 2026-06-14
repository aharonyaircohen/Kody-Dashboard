/**
 * @fileType hook
 * @domain kody
 * @pattern usePreviewUrl
 * @ai-summary Resolves a PR's preview URL on demand (Fly-first, Vercel
 * fallback — the server decides). The preview pane uses this so the link
 * appears immediately on open instead of waiting for the background tasks
 * poll. Pass the PR number so the server can prefer the Fly preview; without
 * it, resolution falls back to the Vercel deployment for `sha`. Shows the
 * already-known URL instantly (placeholder) while confirming, and polls only
 * while the deployment is still building (no URL yet).
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { prsApi, getStoredAuth } from "../api";

const BUILDING_POLL_MS = 15_000;

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
    // Once we have a URL it won't change for this commit — stop polling.
    // While it's null (still building) keep checking so it appears on its own.
    refetchInterval: (q) => (q.state.data ? false : BUILDING_POLL_MS),
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });

  const url = query.data ?? initialUrl ?? null;
  // "Loading" = we have a commit to look up but no URL yet and a fetch is live.
  const isResolving = !!sha && !url && (query.isFetching || query.isPending);

  return { url, isResolving };
}
