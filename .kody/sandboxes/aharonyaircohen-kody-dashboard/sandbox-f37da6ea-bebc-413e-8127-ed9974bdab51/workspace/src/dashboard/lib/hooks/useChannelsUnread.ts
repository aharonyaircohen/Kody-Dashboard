"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern channels-unread-client
 * @ai-summary TanStack Query bindings over /api/kody/messages/read-state.
 *   Combines the per-user channel read-state (gist-backed, synced across
 *   devices) with the polled channel list to derive which channels have
 *   activity newer than the user last opened them — powering the Messages nav
 *   badge and per-channel "new" dots. `markSeen(n)` stamps a channel read.
 *
 *   A channel is unread when its `updatedAt` is newer than `seen[n]` (or, if it
 *   was never opened, newer than the store `baseline`). No baseline yet → never
 *   unread, so a brand-new store doesn't flash the whole history as unread.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { useMessageChannels } from "./useMessages";

interface ChannelsReadState {
  baseline: string | null;
  seen: Record<string, string>;
}

export const channelsReadStateKey = (owner?: string, repo?: string) =>
  ["channels-read-state", owner ?? "", repo ?? ""] as const;

async function fetchReadState(
  headers: Record<string, string>,
): Promise<ChannelsReadState> {
  const res = await fetch("/api/kody/messages/read-state", { headers });
  if (!res.ok) {
    throw new Error(
      (await res.text().catch(() => "")) ||
        `read-state fetch failed (${res.status})`,
    );
  }
  const data = (await res.json()) as Partial<ChannelsReadState>;
  return {
    baseline: typeof data.baseline === "string" ? data.baseline : null,
    seen: data.seen && typeof data.seen === "object" ? data.seen : {},
  };
}

async function postSeen(
  headers: Record<string, string>,
  channelNumber: number,
): Promise<ChannelsReadState> {
  const res = await fetch("/api/kody/messages/read-state", {
    method: "POST",
    headers,
    body: JSON.stringify({ channelNumber }),
  });
  if (!res.ok)
    throw new Error(await res.text().catch(() => "mark-seen failed"));
  const data = (await res.json()) as Partial<ChannelsReadState>;
  return {
    baseline: typeof data.baseline === "string" ? data.baseline : null,
    seen: data.seen && typeof data.seen === "object" ? data.seen : {},
  };
}

export interface UseChannelsUnreadResult {
  /** Channel numbers with activity newer than the user last saw them. */
  unreadChannels: Set<number>;
  unreadCount: number;
  isLoading: boolean;
  markSeen: (channelNumber: number) => Promise<void>;
}

export function useChannelsUnread(): UseChannelsUnreadResult {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const qc = useQueryClient();
  const key = channelsReadStateKey(auth?.owner, auth?.repo);
  const enabled = !!auth;

  const rs = useQuery<ChannelsReadState>({
    queryKey: key,
    queryFn: () => fetchReadState(headers),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

  const channelsQuery = useMessageChannels();
  const channels = useMemo(
    () => (channelsQuery.data?.enabled ? channelsQuery.data.channels : []),
    [channelsQuery.data],
  );

  const unreadChannels = useMemo(() => {
    const set = new Set<number>();
    const baseline = rs.data?.baseline ? Date.parse(rs.data.baseline) : NaN;
    const seen = rs.data?.seen ?? {};
    for (const c of channels) {
      const updated = Date.parse(c.updatedAt);
      if (Number.isNaN(updated)) continue;
      const seenRaw = seen[String(c.number)];
      const ref = seenRaw ? Date.parse(seenRaw) : baseline;
      // No baseline persisted yet → treat as seen (don't flash old history).
      if (Number.isNaN(ref)) continue;
      if (updated > ref) set.add(c.number);
    }
    return set;
  }, [channels, rs.data]);

  const markSeenMut = useMutation({
    mutationFn: (channelNumber: number) => postSeen(headers, channelNumber),
    onSuccess: (next) => qc.setQueryData(key, next),
  });

  // `mutateAsync` is referentially stable across renders; the mutation object
  // itself is NOT — depending on the whole object made `markSeen` change every
  // render, which spun the mark-seen effect into an infinite POST loop.
  const { mutateAsync: markSeenAsync } = markSeenMut;
  const markSeen = useCallback(
    async (channelNumber: number) => {
      await markSeenAsync(channelNumber);
    },
    [markSeenAsync],
  );

  return {
    unreadChannels,
    unreadCount: unreadChannels.size,
    isLoading: rs.isLoading,
    markSeen,
  };
}
